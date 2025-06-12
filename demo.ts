#!/usr/bin/env bun

import { presets, runSimulation } from './simulation';


const demos = [
  {
    name: '🎯 Basic Demo',
    description: 'Simple minting and transfers',
    preset: presets.quick
  },
  {
    name: '🔥 Stress Test',
    description: 'High transaction volume across all entities',
    preset: presets.stress
  },
  {
    name: '🏛️ DAO Governance',
    description: 'Multi-sig proposals and voting cycles',
    preset: presets.governance
  },
  {
    name: '🌐 Payment Hub',
    description: 'Hub-mediated transfers and routing',
    preset: presets.hub
  },
  {
    name: '📈 Economic Model',
    description: 'Boom/bust cycles with adaptive behavior',
    preset: presets.economy
  }
];

const runDemo = async (name: string) => {
  const demo = demos.find(d => d.name.includes(name));
  if (!demo) {
    console.log('Available demos:');
    demos.forEach(d => console.log(`  ${d.name}: ${d.description}`));
    return;
  }
  
  console.log(`\n🎬 Running ${demo.name}`);
  console.log(`📝 ${demo.description}\n`);
  
  await runSimulation(demo.preset);
};

const runAll = async () => {
  console.log('🎪 Running all simulation scenarios...\n');
  
  for (const demo of demos) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎬 ${demo.name}: ${demo.description}`);
    console.log(`${'='.repeat(60)}`);
    
    await runSimulation(demo.preset);
    
  
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n🎉 All demos completed!');
};


const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'basic':
    await runDemo('Basic');
    break;
    
  case 'stress':
    await runDemo('Stress');
    break;
    
  case 'dao':
  case 'governance':
    await runDemo('DAO');
    break;
    
  case 'hub':
  case 'payment':
    await runDemo('Payment');
    break;
    
  case 'economy':
  case 'economic':
    await runDemo('Economic');
    break;
    
  case 'all':
    await runAll();
    break;
    
  default:
    console.log('🎬 XLN Simulation Demo');
    console.log('\nUsage: bun demo.ts <scenario>');
    console.log('\nAvailable scenarios:');
    console.log('  basic      - Simple minting and transfers (10 blocks)');
    console.log('  stress     - High transaction volume (100 blocks)');
    console.log('  dao        - Multi-sig governance (60 blocks)');
    console.log('  hub        - Payment hub routing (40 blocks)');
    console.log('  economy    - Economic boom/bust cycles (120 blocks)');
    console.log('  all        - Run all scenarios sequentially');
    console.log('\nExamples:');
    console.log('  bun demo.ts basic');
    console.log('  bun demo.ts stress');
    console.log('  bun demo.ts all');
} 