const constants = require('./constants');
const config = require('./config');

const VALID_SERVICE_TYPES = ['http', 'https', 'tcp'];
const VALID_HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'];
const VALID_GROUPS = ['基础设施', '业务服务', '外部依赖', '数据存储', '其他'];

function validateServiceConfig(data, index = null) {
  const errors = [];
  const prefix = index !== null ? `[配置项 ${index + 1}] ` : '';

  if (!data || typeof data !== 'object') {
    return [{ field: '(root)', message: `${prefix}配置必须是对象` }];
  }

  if (!data.name || typeof data.name !== 'string' || !data.name.trim()) {
    errors.push({ field: 'name', message: `${prefix}name 为必填字段，不能为空字符串` });
  } else if (data.name.length > 100) {
    errors.push({ field: 'name', message: `${prefix}name 长度不能超过 100 个字符` });
  }

  if (!data.type || typeof data.type !== 'string') {
    errors.push({ field: 'type', message: `${prefix}type 为必填字段` });
  } else if (!VALID_SERVICE_TYPES.includes(data.type)) {
    errors.push({ field: 'type', message: `${prefix}type 必须是 http、https 或 tcp` });
  }

  if (!data.target || typeof data.target !== 'string' || !data.target.trim()) {
    errors.push({ field: 'target', message: `${prefix}target 为必填字段，不能为空字符串` });
  }

  if (data.type === 'tcp') {
    const hasPortInTarget = data.target && data.target.includes(':');
    if (!data.port && !hasPortInTarget) {
      errors.push({ field: 'port', message: `${prefix}TCP 类型必须提供 port 字段或在 target 中包含端口号` });
    }
    if (data.port !== undefined && data.port !== null && data.port !== '') {
      const portNum = Number(data.port);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        errors.push({ field: 'port', message: `${prefix}port 必须是 1-65535 之间的整数` });
      }
    }
  }

  if (data.type === 'http' || data.type === 'https') {
    if (data.method !== undefined && data.method !== null && data.method !== '') {
      if (typeof data.method !== 'string' || !VALID_HTTP_METHODS.includes(data.method.toUpperCase())) {
        errors.push({ field: 'method', message: `${prefix}method 必须是有效的 HTTP 方法: ${VALID_HTTP_METHODS.join(', ')}` });
      }
    }
    if (data.expectedStatus !== undefined && data.expectedStatus !== null && data.expectedStatus !== '') {
      const statusNum = Number(data.expectedStatus);
      if (!Number.isInteger(statusNum) || statusNum < 100 || statusNum > 599) {
        errors.push({ field: 'expectedStatus', message: `${prefix}expectedStatus 必须是 100-599 之间的整数` });
      }
    }
  }

  if (data.interval_seconds !== undefined && data.interval_seconds !== null && data.interval_seconds !== '') {
    const intervalNum = Number(data.interval_seconds);
    if (!Number.isInteger(intervalNum) || intervalNum < constants.DEFAULT_CONFIG.MIN_INTERVAL_SECONDS) {
      errors.push({ field: 'interval_seconds', message: `${prefix}interval_seconds 必须是大于等于 ${constants.DEFAULT_CONFIG.MIN_INTERVAL_SECONDS} 的整数` });
    }
  }

  if (data.timeout_ms !== undefined && data.timeout_ms !== null && data.timeout_ms !== '') {
    const timeoutNum = Number(data.timeout_ms);
    if (!Number.isInteger(timeoutNum) || timeoutNum < 100 || timeoutNum > 60000) {
      errors.push({ field: 'timeout_ms', message: `${prefix}timeout_ms 必须是 100-60000 之间的整数（毫秒）` });
    }
  }

  if (data.enabled !== undefined && data.enabled !== null) {
    if (data.enabled !== 0 && data.enabled !== 1 && typeof data.enabled !== 'boolean') {
      errors.push({ field: 'enabled', message: `${prefix}enabled 必须是 0、1 或布尔值` });
    }
  }

  if (data.group !== undefined && data.group !== null && data.group !== '') {
    if (typeof data.group !== 'string') {
      errors.push({ field: 'group', message: `${prefix}group 必须是字符串` });
    }
  }

  return errors;
}

function validateImportPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: [{ field: '(root)', message: '导入数据必须是 JSON 对象' }], services: [] };
  }

  const services = Array.isArray(payload) ? payload : payload.services;

  if (!Array.isArray(services)) {
    return { valid: false, errors: [{ field: 'services', message: '导入数据必须包含 services 数组，或是直接的服务配置数组' }], services: [] };
  }

  const allErrors = [];
  const validServices = [];
  const validIndices = [];

  services.forEach((svc, index) => {
    const svcErrors = validateServiceConfig(svc, index);
    if (svcErrors.length > 0) {
      allErrors.push(...svcErrors);
    } else {
      validServices.push(normalizeServiceConfig(svc));
      validIndices.push(index);
    }
  });

  const nameCounts = new Map();
  validServices.forEach((svc, idx) => {
    const name = svc.name.trim();
    if (!nameCounts.has(name)) {
      nameCounts.set(name, []);
    }
    nameCounts.get(name).push(validIndices[idx]);
  });

  for (const [name, indices] of nameCounts) {
    if (indices.length > 1) {
      indices.forEach(originalIdx => {
        allErrors.push({
          field: 'name',
          message: `[配置项 ${originalIdx + 1}] name "${name}" 在导入文件中重复出现`
        });
      });
    }
  }

  const uniqueValidServices = [];
  const seenNames = new Set();
  validServices.forEach((svc, idx) => {
    const name = svc.name.trim().toLowerCase();
    if (!seenNames.has(name)) {
      uniqueValidServices.push(svc);
      seenNames.add(name);
    }
  });

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    services: uniqueValidServices
  };
}

function normalizeServiceConfig(data) {
  const normalized = { ...data };
  normalized.name = String(normalized.name).trim();
  normalized.type = String(normalized.type).trim().toLowerCase();
  normalized.target = String(normalized.target).trim();

  if (normalized.method !== undefined && normalized.method !== null && normalized.method !== '') {
    normalized.method = String(normalized.method).toUpperCase();
  } else {
    normalized.method = constants.DEFAULT_CONFIG.DEFAULT_METHOD;
  }

  if (normalized.expectedStatus !== undefined && normalized.expectedStatus !== null && normalized.expectedStatus !== '') {
    normalized.expectedStatus = Number(normalized.expectedStatus);
  } else {
    normalized.expectedStatus = constants.DEFAULT_CONFIG.DEFAULT_EXPECTED_STATUS;
  }

  if (normalized.interval_seconds !== undefined && normalized.interval_seconds !== null && normalized.interval_seconds !== '') {
    normalized.interval_seconds = Number(normalized.interval_seconds);
  } else {
    normalized.interval_seconds = config.defaultCheckIntervalSeconds || constants.DEFAULT_CONFIG.DEFAULT_INTERVAL_SECONDS;
  }

  if (normalized.timeout_ms !== undefined && normalized.timeout_ms !== null && normalized.timeout_ms !== '') {
    normalized.timeout_ms = Number(normalized.timeout_ms);
  } else {
    normalized.timeout_ms = config.defaultTimeoutMs || constants.DEFAULT_CONFIG.DEFAULT_TIMEOUT_MS;
  }

  if (normalized.enabled !== undefined && normalized.enabled !== null) {
    if (typeof normalized.enabled === 'boolean') {
      normalized.enabled = normalized.enabled ? 1 : 0;
    } else {
      normalized.enabled = Number(normalized.enabled) ? 1 : 0;
    }
  } else {
    normalized.enabled = 1;
  }

  if (normalized.port !== undefined && normalized.port !== null && normalized.port !== '') {
    normalized.port = Number(normalized.port);
  } else {
    normalized.port = null;
  }

  if (normalized.group !== undefined) {
    normalized.group = normalized.group === null ? '' : String(normalized.group);
  } else {
    normalized.group = '';
  }

  return normalized;
}

function generateUniqueName(baseName, existingNames) {
  const nameSet = new Set(existingNames.map(n => n.toLowerCase()));
  let candidate = baseName;
  let counter = 1;
  while (nameSet.has(candidate.toLowerCase())) {
    counter++;
    candidate = `${baseName} (${counter})`;
  }
  return candidate;
}

module.exports = {
  validateServiceConfig,
  validateImportPayload,
  normalizeServiceConfig,
  generateUniqueName,
  VALID_SERVICE_TYPES,
  VALID_HTTP_METHODS,
  VALID_GROUPS
};
