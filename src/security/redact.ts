/**
 * 敏感信息扫描与脱敏
 *
 * 在生成技能包前自动扫描并脱敏 API Key、密码、Token 等敏感内容。
 */

/** 脱敏规则 */
interface RedactRule {
  name: string;
  pattern: RegExp;
  replacement: string | ((match: string) => string);
}

const REDACT_RULES: RedactRule[] = [
  {
    name: 'api-key-generic',
    pattern:
      /(?:api[_-]?key|apikey|access[_-]?token|secret[_-]?key|auth[_-]?token)\s*[:=]\s*["']?([A-Za-z0-9_-]{20,})["']?/gi,
    replacement: (m) => m.replace(/([A-Za-z0-9_-]{20,})/, '***REDACTED***'),
  },
  {
    name: 'bearer-token',
    pattern: /Bearer\s+[A-Za-z0-9_.-]{20,}/g,
    replacement: 'Bearer ***REDACTED***',
  },
  {
    name: 'sk-key',
    pattern: /sk-[A-Za-z0-9]{20,}/g,
    replacement: 'sk-***REDACTED***',
  },
  {
    name: 'aws-access-key',
    pattern: /AKIA[A-Z0-9]{16}/g,
    replacement: 'AKIA***REDACTED***',
  },
  {
    name: 'github-token',
    pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
    replacement: 'gh***_***REDACTED***',
  },
  {
    name: 'password-field',
    pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']?([^"'\s]{4,})["']?/gi,
    replacement: (m) =>
      m.replace(/(["']?)([^"'\s]{4,})(["']?)\s*$/, '$1***REDACTED***$3'),
  },
  {
    name: 'private-key-block',
    pattern:
      /-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA )?PRIVATE KEY-----/g,
    replacement:
      '-----BEGIN PRIVATE KEY-----\n***REDACTED***\n-----END PRIVATE KEY-----',
  },
  {
    name: 'connection-string',
    pattern:
      /(?:(?:mysql|postgres(?:ql)?|mongodb(?:\+srv)?|redis|amqp):\/\/)[^:\s]+:[^@\s]+@/g,
    replacement: (m) => m.replace(/\/\/([^:]+):[^@]+@/, '//$1:***REDACTED***@'),
  },
];

export interface RedactResult {
  content: string;
  redactedCount: number;
  matchedRules: string[];
}

/** 扫描并脱敏文本中的敏感信息 */
export function redactContent(content: string): RedactResult {
  let result = content;
  const matchedRules: string[] = [];
  let count = 0;

  for (const rule of REDACT_RULES) {
    const matches = result.match(
      new RegExp(rule.pattern.source, rule.pattern.flags),
    );
    if (matches && matches.length > 0) {
      matchedRules.push(rule.name);
      count += matches.length;
      result = result.replace(
        new RegExp(rule.pattern.source, rule.pattern.flags),
        rule.replacement as string,
      );
    }
  }

  return { content: result, redactedCount: count, matchedRules };
}

/** 检测文本中是否存在敏感信息（不修改原文） */
export function detectSensitiveInfo(content: string): {
  found: boolean;
  rules: string[];
  count: number;
} {
  const rules: string[] = [];
  let count = 0;

  for (const rule of REDACT_RULES) {
    const matches = content.match(
      new RegExp(rule.pattern.source, rule.pattern.flags),
    );
    if (matches && matches.length > 0) {
      rules.push(rule.name);
      count += matches.length;
    }
  }

  return { found: count > 0, rules, count };
}
