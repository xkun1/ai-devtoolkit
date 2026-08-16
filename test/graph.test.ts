import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildDependencyGraph,
  analyzeImpact,
  generateMermaidGraph,
  formatImpactReport,
} from '../src/graph/index.js';
import { extractImports } from '../src/graph/analyzer.js';

const TMP_DIR = join(tmpdir(), `devtoolkit-graph-test-${Date.now()}`);

beforeEach(async () => {
  await mkdir(TMP_DIR, { recursive: true });
  await mkdir(join(TMP_DIR, 'src', 'utils'), { recursive: true });
  await mkdir(join(TMP_DIR, 'src', 'services'), { recursive: true });
  await mkdir(join(TMP_DIR, 'src', 'controllers'), { recursive: true });

  // 创建一个经典的调用链: utils/logger -> services/auth -> controllers/user -> app
  await writeFile(
    join(TMP_DIR, 'src', 'utils', 'logger.ts'),
    'export function log(msg: string) {}',
  );
  await writeFile(
    join(TMP_DIR, 'src', 'services', 'auth.ts'),
    "import { log } from '../utils/logger.js';\nexport class AuthService { login() { log('login'); } }",
  );
  await writeFile(
    join(TMP_DIR, 'src', 'controllers', 'user.ts'),
    "import { AuthService } from '../services/auth.js';\nexport class UserController {}",
  );
  await writeFile(
    join(TMP_DIR, 'src', 'app.ts'),
    "import { UserController } from './controllers/user.js';\nexport const app = {};",
  );
});

afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe('代码依赖图谱 — import 语句解析 (analyzer)', () => {
  it('extractImports 正确解析 TypeScript ES Module 导入', () => {
    const code = [
      "import { a, b as customB } from './moduleA.js';",
      "import * as helper from '../utils/helper.js';",
      "const db = require('./db.js');",
    ].join('\n');

    const imports = extractImports(code, 'typescript');
    expect(imports.length).toBe(3);
    expect(imports[0].rawPath).toBe('./moduleA.js');
    expect(imports[0].specifiers).toEqual(['a', 'b']);
    expect(imports[1].rawPath).toBe('../utils/helper.js');
    expect(imports[2].rawPath).toBe('./db.js');
  });
});

describe('代码依赖图谱 — 图构建与影响面推演 (impact & mermaid)', () => {
  it('buildDependencyGraph 正确构建拓扑与依赖邻接表', async () => {
    const graph = await buildDependencyGraph({ root: TMP_DIR });
    expect(graph.stats.totalFiles).toBe(4);
    expect(graph.stats.totalEdges).toBeGreaterThanOrEqual(3);

    // 验证 services/auth.ts 依赖 utils/logger.ts
    const authDeps = graph.dependencies['src/services/auth.ts'];
    expect(authDeps).toContain('src/utils/logger.ts');

    // 验证 utils/logger.ts 的上游调用方包含 services/auth.ts
    const loggerDependents = graph.dependents['src/utils/logger.ts'];
    expect(loggerDependents).toContain('src/services/auth.ts');
  });

  it('analyzeImpact 能够递归推演出多层上游影响链路', async () => {
    const graph = await buildDependencyGraph({ root: TMP_DIR });

    // 修改底层的 logger.ts，推演所有直接与间接受波及的文件
    const impact = analyzeImpact(graph, 'src/utils/logger.ts');
    expect(impact.directDependents).toEqual(['src/services/auth.ts']);
    expect(impact.totalAffected).toBe(3); // auth -> user -> app
    expect(impact.riskLevel).toBeDefined();

    const report = formatImpactReport(impact);
    expect(report).toContain('🎯 影响面分析报告');
    expect(report).toContain('直接上游依赖方');
    expect(report).toContain('递归传递受影响链路');
  });

  it('generateMermaidGraph 输出合法 Mermaid 语法', async () => {
    const graph = await buildDependencyGraph({ root: TMP_DIR });
    const mermaid = generateMermaidGraph(graph, { direction: 'LR' });

    expect(mermaid).toContain('graph LR');
    expect(mermaid).toContain('-->');
  });
});

describe('代码依赖图谱 — Go / Rust / Java 多语言依赖解析', () => {
  it('extractImports 解析 Go 语言单行与块导入', () => {
    const goCode = `package main

import "fmt"
import "myproject/pkg/util"
import (
    "net/http"
    custom "myproject/services/auth"
)
`;
    const imports = extractImports(goCode, 'go');
    expect(imports.length).toBe(4);
    expect(imports.some((i) => i.rawPath === 'myproject/pkg/util')).toBe(true);
    expect(imports.some((i) => i.rawPath === 'myproject/services/auth')).toBe(
      true,
    );
  });

  it('extractImports 解析 Rust mod 与 use crate 导入', () => {
    const rustCode = `
mod models;
pub mod service;

use crate::models::User;
use crate::service::{AuthService, Token};
use super::helper;
`;
    const imports = extractImports(rustCode, 'rust');
    expect(imports.length).toBe(5);
    expect(imports.some((i) => i.rawPath === 'models')).toBe(true);
    expect(imports.some((i) => i.rawPath === 'crate::models::User')).toBe(true);
    expect(imports.some((i) => i.rawPath === 'super::helper')).toBe(true);
  });

  it('extractImports 解析 Java 业务包导入', () => {
    const javaCode = `package com.example.app;

import java.util.List;
import com.example.service.UserService;
import static com.example.constants.Config.MAX_RETRY;
`;
    const imports = extractImports(javaCode, 'java');
    expect(imports.length).toBe(2);
    expect(
      imports.some((i) => i.rawPath === 'com.example.service.UserService'),
    ).toBe(true);
    expect(
      imports.some(
        (i) => i.rawPath === 'com.example.constants.Config.MAX_RETRY',
      ),
    ).toBe(true);
  });
});
