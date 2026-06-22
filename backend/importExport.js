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

function sanitizeForExport(service, compact = false) {
  const base = {
    name: service.name,
    type: service.type,
    target: service.target
  };

  if (compact) {
    if (service.port !== null && service.port !== undefined) base.port = service.port;
    if (service.type !== 'tcp' && service.method && service.method !== 'GET') base.method = service.method;
    if (service.type !== 'tcp' && service.expectedStatus && service.expectedStatus !== 200) base.expectedStatus = service.expectedStatus;
    if (service.interval_seconds && service.interval_seconds !== 30) base.interval_seconds = service.interval_seconds;
    if (service.timeout_ms && service.timeout_ms !== 5000) base.timeout_ms = service.timeout_ms;
    if (service.enabled === 0 || service.enabled === false) base.enabled = false;
    if (service.group) base.group = service.group;
    return base;
  }

  return {
    ...base,
    port: service.port || null,
    method: service.method || 'GET',
    expectedStatus: service.expectedStatus || 200,
    interval_seconds: service.interval_seconds || 30,
    timeout_ms: service.timeout_ms || 5000,
    enabled: service.enabled ? true : false,
    group: service.group || ''
  };
}

function processSingleService(svc, originalIndex, strategy, conflictResolutions, workingNameSet, importServices) {
  let actualStrategy = strategy;
  if (conflictResolutions[originalIndex]) {
    actualStrategy = conflictResolutions[originalIndex];
  }

  const nameLower = svc.name.toLowerCase();

  if (workingNameSet.has(nameLower)) {
    if (actualStrategy === CONFLICT_STRATEGIES.SKIP) {
      return {
        action: 'skip',
        data: {
          index: originalIndex,
          name: svc.name,
          reason: '同名服务已存在，已跳过'
        },
        log: `[跳过] ${svc.name}: 同名服务已存在`
      };
    }

    if (actualStrategy === CONFLICT_STRATEGIES.OVERWRITE) {
      return {
        action: 'overwrite',
        serviceName: svc.name,
        serviceData: svc,
        originalIndex
      };
    }

    if (actualStrategy === CONFLICT_STRATEGIES.DUPLICATE) {
      const newName = validator.generateUniqueName(svc.name, Array.from(workingNameSet));
      svc.name = newName;
      workingNameSet.add(newName.toLowerCase());
      return {
        action: 'create',
        serviceData: svc,
        originalIndex,
        isDuplicate: true
      };
    }
  }

  workingNameSet.add(svc.name.toLowerCase());
  return {
    action: 'create',
    serviceData: svc,
    originalIndex,
    isDuplicate: false
  };
}

async function executeAction(actionResult) {
  try {
    if (actionResult.action === 'skip') {
      return { type: 'skipped', data: actionResult.data, log: actionResult.log };
    }

    if (actionResult.action === 'overwrite') {
      const existing = await storage.services.getByName(actionResult.serviceName);
      if (!existing) {
        const created = await storage.services.create(actionResult.serviceData);
        if (created.enabled) scheduler.startServiceCheck(created);
        notifier.notifyServiceUpdate(created.id, created);
        return {
          type: 'imported',
          data: { index: actionResult.originalIndex, name: created.name, id: created.id, action: 'created' },
          log: `[创建] ${created.name}: 新服务 #${created.id}`
        };
      }

      const updateData = { ...actionResult.serviceData };
      delete updateData.id;
      delete updateData.created_at;
      delete updateData.updated_at;
      const updated = await storage.services.update(existing.id, updateData);
      scheduler.restartServiceCheck(updated);
      notifier.notifyServiceUpdate(updated.id, updated);
      return {
        type: 'imported',
        data: { index: actionResult.originalIndex, name: updated.name, id: updated.id, action: 'overwritten' },
        log: `[覆盖] ${updated.name}: 已更新现有服务 #${updated.id}`
      };
    }

    if (actionResult.action === 'create') {
      const created = await storage.services.create(actionResult.serviceData);
      if (created.enabled) scheduler.startServiceCheck(created);
      notifier.notifyServiceUpdate(created.id, created);
      const namePart = actionResult.isDuplicate
        ? `${actionResult.serviceData.name} (副本)`
        : created.name;
      return {
        type: 'imported',
        data: {
          index: actionResult.originalIndex,
          name: created.name,
          id: created.id,
          action: actionResult.isDuplicate ? 'duplicated' : 'created'
        },
        log: `[创建] ${created.name}${actionResult.isDuplicate ? ' (副本)' : ''}: 新服务 #${created.id}`
      };
    }

    return {
      type: 'failed',
      data: { index: actionResult.originalIndex, name: actionResult.serviceData?.name || 'unknown', error: '未知操作类型' },
      log: `[失败] ${actionResult.serviceData?.name || 'unknown'}: 未知操作类型`
    };
  } catch (e) {
    return {
      type: 'failed',
      data: { index: actionResult.originalIndex, name: actionResult.serviceData?.name || 'unknown', error: e.message },
      log: `[失败] ${actionResult.serviceData?.name || 'unknown'}: ${e.message}`
    };
  }
}

router.post('/services/import/preview', async (req, res) => {
  try {
    const payload = req.body;
    const { valid, errors, services } = validator.validateImportPayload(payload);

    const totalCount = Array.isArray(payload) ? payload.length : (payload.services?.length || 0);

    const existingNames = await storage.services.getAllNames();
    const existingNameSet = new Set(existingNames.map(n => n.toLowerCase()));

    const conflicts = [];
    const conflictBatchSize = 100;

    for (let i = 0; i < services.length && conflicts.length < 500; i += conflictBatchSize) {
      const batch = services.slice(i, i + conflictBatchSize);
      for (let j = 0; j < batch.length; j++) {
        const svc = batch[j];
        const globalIdx = i + j;
        if (existingNameSet.has(svc.name.toLowerCase())) {
          if (conflicts.length < 500) {
            const existing = await storage.services.getByName(svc.name);
            conflicts.push({
              index: globalIdx,
              name: svc.name,
              existingId: existing?.id,
              existingConfig: existing ? sanitizeForExport(existing, true) : null,
              newConfig: sanitizeForExport(svc, true)
            });
          }
        }
      }
      await new Promise(r => setImmediate(r));
    }

    res.json({
      valid,
      errors: errors.slice(0, 500),
      totalCount,
      validCount: services.length,
      invalidCount: totalCount - services.length,
      conflictsTruncated: conflicts.length >= 500,
      conflicts,
      preview: services.slice(0, 10).map(s => sanitizeForExport(s, true))
    });
  } catch (e) {
    console.error('[ImportExport] Preview error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/services/import/batch', async (req, res) => {
  try {
    const {
      services: importServices,
      conflictStrategy = CONFLICT_STRATEGIES.SKIP,
      conflictResolutions = {},
      existingNames: passedExistingNames = null
    } = req.body || {};

    if (!Array.isArray(importServices)) {
      return res.status(400).json({ error: 'services 必须是数组' });
    }

    if (importServices.length > 100) {
      return res.status(400).json({ error: '单批导入不能超过 100 条，请分批导入' });
    }

    if (!Object.values(CONFLICT_STRATEGIES).includes(conflictStrategy)) {
      return res.status(400).json({ error: `conflictStrategy 必须是 ${Object.values(CONFLICT_STRATEGIES).join(', ')} 之一` });
    }

    const { valid, errors, services: validServices } = validator.validateImportPayload({ services: importServices });

    let workingNameArr = passedExistingNames;
    if (!workingNameArr) {
      workingNameArr = await storage.services.getAllNames();
    }
    let workingNameSet = new Set(workingNameArr.map(n => n.toLowerCase()));

    const imported = [];
    const skipped = [];
    const failed = [];
    const logs = [];
    const newNames = [];

    for (let i = 0; i < validServices.length; i++) {
      const svc = validServices[i];
      const originalIndex = i;

      const actionResult = processSingleService(
        svc, originalIndex, conflictStrategy, conflictResolutions, workingNameSet, importServices
      );

      if (actionResult.action === 'skip') {
        skipped.push(actionResult.data);
        logs.push(actionResult.log);
        continue;
      }

      const result = await executeAction(actionResult);
      if (result.type === 'imported') {
        imported.push(result.data);
        newNames.push(result.data.name);
      } else if (result.type === 'skipped') {
        skipped.push(result.data);
      } else {
        failed.push(result.data);
      }
      logs.push(result.log);
    }

    res.json({
      success: true,
      batchSize: importServices.length,
      imported,
      skipped,
      failed,
      validationErrors: errors,
      newNames,
      logs
    });
  } catch (e) {
    console.error('[ImportExport] Batch import error:', e);
    res.status(500).json({ error: e.message });
  }
});

router.post('/services/import', async (req, res) => {
  try {
    const {
      services: importServices,
      conflictStrategy = CONFLICT_STRATEGIES.SKIP,
      conflictResolutions = {}
    } = req.body || {};

    if (!Array.isArray(importServices)) {
      return res.status(400).json({ error: 'services 必须是数组' });
    }

    const { valid, errors, services: validServices } = validator.validateImportPayload({ services: importServices });

    if (validServices.length === 0) {
      return res.json({
        success: false,
        message: '没有有效的服务配置',
        errors,
        imported: [],
        skipped: [],
        failed: [],
        logs: ['[信息] 没有可导入的有效配置']
      });
    }

    const existingNames = await storage.services.getAllNames();
    let workingNameSet = new Set(existingNames.map(n => n.toLowerCase()));

    const imported = [];
    const skipped = [];
    const failed = [];
    const logs = [];

    logs.push(`[信息] 开始导入 ${validServices.length} 条有效配置...`);

    const batchSize = 50;
    for (let i = 0; i < validServices.length; i += batchSize) {
      const batch = validServices.slice(i, i + batchSize);

      for (let j = 0; j < batch.length; j++) {
        const svc = batch[j];
        const originalIndex = i + j;

        const actionResult = processSingleService(
          svc, originalIndex, conflictStrategy, conflictResolutions, workingNameSet, importServices
        );

        if (actionResult.action === 'skip') {
          skipped.push(actionResult.data);
          logs.push(actionResult.log);
          continue;
        }

        const result = await executeAction(actionResult);
        if (result.type === 'imported') {
          imported.push(result.data);
        } else if (result.type === 'skipped') {
          skipped.push(result.data);
        } else {
          failed.push(result.data);
        }
        logs.push(result.log);
      }

      if (i + batchSize < validServices.length) {
        await new Promise(r => setImmediate(r));
      }
    }

    logs.push(`[信息] 导入完成: 成功 ${imported.length} 条, 跳过 ${skipped.length} 条, 失败 ${failed.length} 条`);

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
    const { group, type, enabled, compact = 'true', format = 'json' } = req.query;
    const useCompact = compact !== 'false' && compact !== false;

    let services;
    if (group) {
      services = await storage.services.getByGroup(group);
    } else {
      services = await storage.services.getAll();
    }

    if (type) {
      services = services.filter(s => s.type === type);
    }

    if (enabled !== undefined && enabled !== '') {
      const enabledBool = enabled === 'true' || enabled === '1' || enabled === true;
      services = services.filter(s => (s.enabled ? true : false) === enabledBool);
    }

    const exported = services.map(s => sanitizeForExport(s, useCompact));

    const exportData = {
      version: '1.0',
      exportedAt: new Date().toISOString(),
      count: exported.length,
      compact: useCompact,
      filter: {
        group: group || null,
        type: type || null,
        enabled: enabled !== undefined && enabled !== ''
          ? (enabled === 'true' || enabled === '1' || enabled === true)
          : null
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
    _comment: '服务配置导入模板 - 仅 name, type, target 为必填，其他可省略使用默认值',
    version: '1.0',
    services: [
      {
        name: '示例-HTTP服务',
        type: 'https',
        target: 'https://api.example.com/health',
        group: '业务服务'
      },
      {
        name: '示例-TCP端口',
        type: 'tcp',
        target: '192.168.1.100',
        port: 3306,
        interval_seconds: 60,
        group: '数据存储'
      },
      {
        name: '示例-高级配置',
        type: 'http',
        target: 'http://internal-app/health',
        method: 'POST',
        expectedStatus: 201,
        interval_seconds: 15,
        timeout_ms: 10000,
        enabled: false,
        group: '基础设施'
      }
    ]
  };

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="services-template.json"');
  res.send(JSON.stringify(template, null, 2));
});

module.exports = router;
