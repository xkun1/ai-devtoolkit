/**
 * 技能包生命周期管理类型定义
 */

/** 已安装技能包的元信息 */
export interface InstalledSkill {
  /** 技能名（slug） */
  name: string;
  /** 目标 Agent 类型 */
  agentType: string;
  /** 主文件路径 */
  primaryPath: string;
  /** 所有产物路径 */
  artifactPaths: string[];
  /** 源文档指纹（SHA-256） */
  sourceFingerprint: string;
  /** 生成时间戳 */
  generatedAt: number;
  /** 版本号 */
  version: number;
}

/** 项目技能包注册表 */
export interface SkillRegistry {
  version: string;
  projectRoot: string;
  skills: Record<string, InstalledSkill>;
}

/** 状态检查结果 */
export interface SkillStatus {
  name: string;
  agentType: string;
  primaryPath: string;
  exists: boolean;
  stale: boolean;
  lastGeneratedAt: number;
}
