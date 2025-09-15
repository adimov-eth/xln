#!/usr/bin/env bun
// Debug helper - run with: bun repl debug.js

const { env } = await import('../../src/server.ts');

console.log('🔧 XLN Environment loaded!');
console.log(`📊 Replicas: ${env.replicas.size}, Height: ${env.height}`);
console.log(`🔍 Available: env.replicas, env.height, env.timestamp`);
console.log(`💡 Try: env.replicas.get('chat:alice')`);
console.log(`💡 Try: env.replicas.get('chat:alice').state.messages`); 

// Make env available in REPL context
global.env = env; 
