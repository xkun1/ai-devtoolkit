/**
 * 技能包生命周期管理统一入口
 */
export {
  loadRegistry,
  saveRegistry,
  registerSkill,
  listSkills,
  removeSkill,
  REGISTRY_FILENAME,
  REGISTRY_VERSION,
  RegistryValidationError,
} from './registry.js';

export type { InstalledSkill, SkillRegistry, SkillStatus } from './types.js';
