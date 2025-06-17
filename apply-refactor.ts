#!/usr/bin/env bun

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

type CodeBlock = {
  filePath: string;
  content: string;
  startLine: number;
  endLine: number;
};

type Options = {
  dryRun: boolean;
  verbose: boolean;
};

async function parseRefactorFile(filePath: string): Promise<CodeBlock[]> {
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  const codeBlocks: CodeBlock[] = [];
  
  let currentBlock: Partial<CodeBlock> | null = null;
  let inCodeBlock = false;
  let codeLines: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // Check for file path header
    if (line.startsWith('# /') && !inCodeBlock) {
      currentBlock = {
        filePath: line.substring(2).trim(),
        startLine: i + 1
      };
    }
    // Check for code block start
    else if (line.trim() === '```typescript' && currentBlock) {
      inCodeBlock = true;
      codeLines = [];
    }
    // Check for code block end
    else if (line.trim() === '```' && inCodeBlock && currentBlock) {
      inCodeBlock = false;
      currentBlock.content = codeLines.join('\n');
      currentBlock.endLine = i + 1;
      codeBlocks.push(currentBlock as CodeBlock);
      currentBlock = null;
    }
    // Collect code lines
    else if (inCodeBlock) {
      codeLines.push(line);
    }
  }
  
  return codeBlocks;
}

function transformPath(filePath: string): string {
  // Transform v3 paths to v4 paths
  return filePath.replace('/v3/', '/v4/');
}

async function ensureDirectory(filePath: string): Promise<void> {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
}

async function applyCodeBlock(block: CodeBlock, options: Options): Promise<void> {
  const targetPath = transformPath(block.filePath);
  
  if (options.verbose) {
    console.log(`Processing: ${block.filePath} -> ${targetPath}`);
  }
  
  if (options.dryRun) {
    console.log(`[DRY RUN] Would write ${block.content.split('\n').length} lines to ${targetPath}`);
    return;
  }
  
  try {
    await ensureDirectory(targetPath);
    await writeFile(targetPath, block.content, 'utf-8');
    console.log(`✓ Written: ${targetPath}`);
  } catch (error) {
    console.error(`✗ Failed to write ${targetPath}:`, error);
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const options: Options = {
    dryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v')
  };
  
  const refactorFile = join(process.cwd(), 'reference/refactor.md');
  
  if (!existsSync(refactorFile)) {
    console.error(`Error: Cannot find ${refactorFile}`);
    process.exit(1);
  }
  
  console.log(`Parsing refactor file: ${refactorFile}`);
  console.log(`Options: ${JSON.stringify(options)}`);
  console.log('---');
  
  try {
    const codeBlocks = await parseRefactorFile(refactorFile);
    console.log(`Found ${codeBlocks.length} code blocks to process`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const block of codeBlocks) {
      try {
        await applyCodeBlock(block, options);
        successCount++;
      } catch (error) {
        errorCount++;
        if (!options.dryRun) {
          console.error(`Continuing after error...`);
        }
      }
    }
    
    console.log('---');
    console.log(`Summary: ${successCount} successful, ${errorCount} errors`);
    
    if (errorCount > 0 && !options.dryRun) {
      process.exit(1);
    }
  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Run the script
if (import.meta.main) {
  main().catch(console.error);
}