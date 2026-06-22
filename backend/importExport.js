const express = require('express');
const router = express.Router();
const storage = require('./storage');
const validator = require('./validator');
const scheduler = require('./scheduler');
const notifier = require('./notifier');

const CONFLICT_STRATEGIES = {
  SKIP: 'skip',
  OVERWRITE: 'overwrite',
  DUPLICATE: 'duplicate'
};

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeForExport(service) {
  return {
    name: service.name,
    type: service.type,
    target: service.target,
    port: service.port || null,
    method: service.method || 'GET',
    expectedStatus: service.expectedStatus || 200,
    interval_seconds: service.interval_seconds || 30,
    timeout_ms: service.timeout_ms || 5000,
    enabled: service.enabled ? true : false,
    group: service.group || ''
  };
}

router.post('/services/import/preview', async (req, res) => {
  try {
    const payload = req.body;
    const { valid, errors, services } = validator.validateImportPayload(payload);

    const conflicts = [];
    const existingNames = await storage.services.getAllNames();
    const existingNameSet = new Set(existingNames.map(n => n.toLowerCase()));

    for (let i = 0; i < services.length; i++) {
      const svc = services[i];
      if (existingNameSet.has(svc.name.toLowerCase())) {
        const existing = await storage.services.getByName(svc.name);
        conflicts.push({
          index: i,
          name: svc.name,
          existingId: existing.id,
          existingConfig: sanitizeForExport(existing),
          newConfig: sanitizeForExport(svc)
        });
      }
    }

    res.json({
      valid,
      errors,
      totalCount: Array.isArray(payload) ? payload.length : (payload.services?.length || 0),
      validCount: services.length,
      invalidCount: (Array.isArray(payload) ? payload.length : (payload.services?.length || 0)) - services.length,
      conflicts,
      preview: services.slice(0, 10).map(s => sanitizeForExport(s))
    });
  } catch (e) {
    console.error('[ImportExport] Preview error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/services/import', async (req, res) => {
  try {
    const { services: importServices, conflictStrategy = CONFLICT_STRATEGIES.SKIP, conflictResolutions = {} } = req.body || {};

    if (!Array.isArray(importServices)) {
      return res.status(400).json({ error: 'services 必须是数组' });
    }

    if (!Object.values(CONFLICT_STRATEGIES).includes(conflictStrategy)) {
      return res.status(400).json({ error: `conflictStrategy 必须是 ${Object.values(CONFLICT_STRATEGIES).join(', ')} 之一` });
    }

    const { valid, errors, services: validServices } = validator.validateImportPayload({ services: importServices });

    if (validServices.length === 0) {
      return res.json({
        success: false,
        message: '没有有效的服务配置',
        errors,
        imported: [],
        skipped: [],
        failed: []
      });
    }

    const existingNames = await storage.services.getAllNames();
    let workingNameSet = new Set(existingNames.map(n => n.toLowerCase()));

    const imported = [];
    const skipped = [];
    const failed = [];
    const logs = [];

    const batchSize = 20;
    for (let i = 0; i < validServices.length; i += batchSize) {
      const batch = validServices.slice(i, i + batchSize);

      for (let j = 0; j < batch.length; j++) {
        const originalIndex = i + j;
        const svc = batch[j];
        const originalItem = importServices[originalIndex];
        const originalSvcIndex = importServices.indexOf(originalItem);

        let strategy = conflictStrategy;
        if (conflictResolutions[originalSvcIndex]) {
          strategy = conflictResolutions[originalSvcIndex];
        }

        const nameLower = svc.name.toLowerCase();

        if (workingNameSet.has(nameLower)) {
          const existing = await storage.services.getByName(svc.name);

          if (strategy === CONFLICT_STRATEGIES.SKIP) {
            skipped.push({
              index: originalSvcIndex,
              name: svc.name,
              reason: '同名服务已存在，已跳过'
            });
            logs.push(`[跳过] ${svc.name}: 同名服务已存在`);
            continue;
          }

          if (strategy === CONFLICT_STRATEGIES.OVERWRITE) {
            try {
              const updateData = { ...svc };
              delete updateData.id;
              delete updateData.created_at;
              delete updateData.updated_at;
              const updated = await storage.services.update(existing.id, updateData);
              scheduler.restartServiceCheck(updated);
              notifier.notifyServiceUpdate(updated.id, updated);
              imported.push({
                index: originalSvcIndex,
                name: svc.name,
                id: updated.id,
                action: 'overwritten'
              });
              logs.push(`[覆盖] ${svc.name}: 已更新现有服务 #${updated.id}`);
              continue;
            } catch (e) {
              failed.push({
                index: originalSvcIndex,
                name: svc.name,
                error: e.message
              });
              logs.push(`[失败] ${svc.name}: ${e.message}`);
              continue;
            }
          }

          if (strategy === CONFLICT_STRATEGIES.DUPLICATE) {
            const newName = validator.generateUniqueName(svc.name, Array.from(workingNameSet));
            svc.name = newName;
            workingNameSet.add(newName.toLowerCase());
          }
        }

        try {
          const created = await storage.services.create(svc);
          workingNameSet.add(created.name.toLowerCase());
          if (created.enabled) {
            scheduler.startServiceCheck(created);
          }
          notifier.notifyServiceUpdate(created.id, created);
          imported.push({
            index: originalSvcIndex,
            name: created.name,
            id: created.id,
            action: 'created'
          });
          logs.push(`[创建] ${created.name}: 新服务 #${created.id}`);
        } catch (e) {
          failed.push({
            index: originalSvcIndex,
            name: svc.name,
            error: e.message
          });
          logs.push(`[失败] ${svc.name}: ${e.message}`);
        }
      }

      if (i + batchSize < validServices.length) {
        await delay(10);
      }
    }

    res.json({
      success: true,
      total: importServices.length,
      validCount: validServices.length,
      invalidCount: importServices.length - validServices.length,
      imported,
      skipped,
      failed,
      validationErrors: errors,
      logs
    });
  } catch (e) {
    console.error('[ImportExport] Import error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/services/export', async (req, res) => {
  try {
    const { group, type, format = 'json' } = req.query;

    let services;
    if (group) {
      services = await storage.services.getByGroup(group);
    } else {
      services = await storage.services.getAll();
    }

    if (type) {
      services = services.filter(s => s.type === type);
    }

    const exported = services.map(s => sanitizeForExport(s));

    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      count: exported.length,
      filter: {
        group: group || null,
        type: type || null
      },
      services: exported
    };

    if (format === 'pretty' || format === 'json') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="services-export-${Date.now()}.json"`);
      res.send(JSON.stringify(exportData, null, 2));
    } else {
      res.json(exportData);
    }
  } catch (e) {
    console.error('[ImportExport] Export error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/services/groups', async (req, res) => {
  try {
    const groups = await storage.services.getGroups();
    res.json(groups);
  } catch (e) {
    console.error('[ImportExport] Groups error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.get('/services/template', (req, res) => {
  const template = {
    _comment: '服务配置导入模板 - 填写后删除注释行',
    version: '1.0',
    services: [
      {
        name: '示例-HTTP服务',
        type: 'https',
        target: 'https://api.example.com/health',
        method: 'GET',
        expectedStatus: 200,
        interval_seconds: 30,
        timeout_ms: 5000,
        enabled: true,
        group: '业务服务'
      },
      {
        name: '示例-TCP端口',
        type: 'tcp',
        target: '192.168.1.100',
        port: 3306,
        interval_seconds: 60,
        timeout_ms: 3000,
        enabled: true,
        group: '数据存储'
      }
    ]
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="services-template.json"');
  res.send(JSON.stringify(template, null, 2));
});

module.exports = router;
