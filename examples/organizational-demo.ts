#!/usr/bin/env bun

/**
 * XLN Organizational Features Demo
 *
 * Demonstrates:
 * 1. Creating entities with dual-class shares
 * 2. Setting up risk committees
 * 3. Spawning subsidiaries and SPVs
 * 4. Joint ventures between entities
 * 5. Complete organizational structures
 */

import { ethers } from 'ethers';
import chalk from 'chalk';
import {
  DualClassShares,
  RiskCommittee,
  SubsidiaryFactory,
  type DualClassConfig,
  type RiskCommitteeMember,
  type SubsidiaryConfig
} from '../src/organizations/index.js';

/**
 * Demo: Tech Startup with Dual-Class Structure
 */
async function demoTechStartup() {
  console.log(chalk.blue('\n' + '═'.repeat(60)));
  console.log(chalk.blue.bold('     TECH STARTUP WITH DUAL-CLASS SHARES'));
  console.log(chalk.blue('═'.repeat(60)));

  // Configure dual-class share structure
  const dualClassConfig: DualClassConfig = {
    entityId: 'tech-startup-001',
    classA: {
      symbol: 'TECH-A',
      name: 'Class A Common',
      votingMultiplier: 1,
      economicMultiplier: 1,
      totalSupply: 0n,
      transferRestrictions: [],
      conversionRights: [],
      dividendPriority: 1
    },
    classB: {
      symbol: 'TECH-B',
      name: 'Class B Super-Voting',
      votingMultiplier: 10, // 10x voting power
      economicMultiplier: 1,
      totalSupply: 0n,
      transferRestrictions: [
        { type: 'lockup', expiresAt: Date.now() + 365 * 24 * 3600 * 1000 }
      ],
      conversionRights: [
        {
          targetClass: 'A',
          ratio: 1,
          trigger: { type: 'transfer', condition: 'any_transfer' }
        }
      ],
      dividendPriority: 1
    },
    sunsetProvision: {
      type: 'time',
      triggerValue: Date.now() + 7 * 365 * 24 * 3600 * 1000, // 7 years
      conversionRatio: 1,
      activated: false
    },
    votingAgreements: []
  };

  const shares = new DualClassShares(dualClassConfig);

  // Issue shares to founders (Class B)
  console.log(chalk.cyan('\n📊 Issuing founder shares...'));
  await shares.issueShares('founder-1', 'B', ethers.parseEther('1000000'));
  await shares.issueShares('founder-2', 'B', ethers.parseEther('1000000'));
  console.log(chalk.green('  ✓ 2M Class B shares issued to founders'));

  // Issue shares to investors (Class A)
  console.log(chalk.cyan('\n💰 Issuing investor shares...'));
  await shares.issueShares('vc-fund-1', 'A', ethers.parseEther('500000'));
  await shares.issueShares('vc-fund-2', 'A', ethers.parseEther('300000'));
  await shares.issueShares('angel-pool', 'A', ethers.parseEther('200000'));
  console.log(chalk.green('  ✓ 1M Class A shares issued to investors'));

  // Issue employee options (Class A with vesting)
  console.log(chalk.cyan('\n👥 Creating employee option pool...'));
  await shares.issueShares('employee-pool', 'A', ethers.parseEther('500000'), {
    startTime: Date.now(),
    cliffTime: Date.now() + 365 * 24 * 3600 * 1000, // 1 year cliff
    endTime: Date.now() + 4 * 365 * 24 * 3600 * 1000, // 4 year vest
    totalShares: ethers.parseEther('500000'),
    vestedShares: 0n,
    releasedShares: 0n
  });
  console.log(chalk.green('  ✓ 500k Class A shares in option pool with 4-year vesting'));

  // Calculate voting power
  console.log(chalk.cyan('\n🗳️  Voting Power Analysis:'));
  const founderVotes = shares.calculateVotingPower('founder-1');
  const vcVotes = shares.calculateVotingPower('vc-fund-1');
  console.log(`  Founder 1: ${ethers.formatEther(founderVotes)} votes (50% with 10x multiplier)`);
  console.log(`  VC Fund 1: ${ethers.formatEther(vcVotes)} votes (25% economic, 1x multiplier)`);

  // Show distribution
  const distribution = shares.getShareDistribution();
  console.log(chalk.cyan('\n📈 Share Distribution:'));
  console.log(`  Class A: ${distribution.classA.totalSupply} shares (${distribution.classA.holders.length} holders)`);
  console.log(`  Class B: ${distribution.classB.totalSupply} shares (${distribution.classB.holders.length} holders)`);

  // Test proposal outcomes
  console.log(chalk.cyan('\n📋 Governance Scenarios:'));
  const scenarios = [
    { type: 'ordinary', votesFor: founderVotes, votesAgainst: vcVotes },
    { type: 'special', votesFor: founderVotes, votesAgainst: vcVotes },
    { type: 'amendment', votesFor: founderVotes + vcVotes / 2n, votesAgainst: vcVotes / 2n }
  ];

  for (const scenario of scenarios) {
    const passes = shares.checkProposalOutcome(
      scenario.type,
      scenario.votesFor,
      scenario.votesAgainst
    );
    console.log(`  ${scenario.type}: ${passes ? '✅ PASSES' : '❌ FAILS'}`);
  }
}

/**
 * Demo: Financial Institution with Risk Committee
 */
async function demoFinancialInstitution() {
  console.log(chalk.blue('\n' + '═'.repeat(60)));
  console.log(chalk.blue.bold('   FINANCIAL INSTITUTION WITH RISK COMMITTEE'));
  console.log(chalk.blue('═'.repeat(60)));

  const riskCommittee = new RiskCommittee('financial-inst-001');

  // Add committee members
  console.log(chalk.cyan('\n👔 Appointing Risk Committee...'));

  const members: RiskCommitteeMember[] = [
    {
      address: 'member-1',
      name: 'Chief Risk Officer',
      role: 'chair',
      votingPower: 2,
      specializations: ['credit', 'market', 'liquidity'],
      joinedAt: Date.now(),
      term: {
        start: Date.now(),
        end: Date.now() + 3 * 365 * 24 * 3600 * 1000,
        renewable: true
      }
    },
    {
      address: 'member-2',
      name: 'Independent Director',
      role: 'member',
      votingPower: 1,
      specializations: ['regulatory', 'reputational'],
      joinedAt: Date.now(),
      term: {
        start: Date.now(),
        end: Date.now() + 2 * 365 * 24 * 3600 * 1000,
        renewable: true
      }
    },
    {
      address: 'member-3',
      name: 'Technology Expert',
      role: 'member',
      votingPower: 1,
      specializations: ['technology', 'operational'],
      joinedAt: Date.now(),
      term: {
        start: Date.now(),
        end: Date.now() + 2 * 365 * 24 * 3600 * 1000,
        renewable: false
      }
    }
  ];

  for (const member of members) {
    await riskCommittee.addMember(member);
    console.log(chalk.green(`  ✓ Appointed ${member.name} as ${member.role}`));
  }

  // Update risk exposures
  console.log(chalk.cyan('\n📊 Updating Risk Exposures...'));

  const exposures = [
    {
      channelId: 'channel-001',
      counterparty: 'corporate-client-1',
      exposureType: 'credit' as const,
      currentValue: ethers.parseEther('500000'),
      maxValue: ethers.parseEther('1000000'),
      utilization: 50,
      lastUpdated: Date.now()
    },
    {
      channelId: 'channel-002',
      counterparty: 'hedge-fund-1',
      exposureType: 'derivative' as const,
      currentValue: ethers.parseEther('2000000'),
      maxValue: ethers.parseEther('5000000'),
      utilization: 40,
      lastUpdated: Date.now()
    },
    {
      channelId: 'channel-003',
      counterparty: 'retail-aggregator',
      exposureType: 'operational' as const,
      currentValue: ethers.parseEther('100000'),
      maxValue: ethers.parseEther('500000'),
      utilization: 20,
      lastUpdated: Date.now()
    }
  ];

  for (const exposure of exposures) {
    await riskCommittee.updateExposure(exposure);
    console.log(chalk.green(`  ✓ Updated ${exposure.exposureType} exposure: ${ethers.formatEther(exposure.currentValue)}`));
  }

  // Submit risk assessment
  console.log(chalk.cyan('\n🔍 Submitting Risk Assessment...'));
  const assessment = await riskCommittee.submitRiskAssessment({
    submitter: 'risk-analyst-1',
    exposure: ethers.parseEther('3000000'),
    counterpartyRating: 75,
    complexityScore: 6,
    regulatoryFlags: ['KYC_PENDING']
  });

  console.log(`  Risk Score: ${assessment.riskScore}/100`);
  console.log(`  Status: ${assessment.status}`);
  console.log(`  Required Approvals: ${assessment.requiredApprovals.join(', ') || 'None (auto-approved)'}`);

  // Generate risk report
  const report = riskCommittee.generateRiskReport();
  console.log(chalk.cyan('\n📑 Risk Report Summary:'));
  console.log(`  Total Exposure: ${ethers.formatEther(report.metrics.totalExposure)}`);
  console.log(`  Risk Score: ${report.metrics.riskScore}`);
  console.log(`  Active Policies: ${report.activePolicies.length}`);
  console.log(`  Committee Size: ${report.committeeSize}`);
  console.log(`  Compliance Score: ${report.complianceScore}/100`);
}

/**
 * Demo: Corporate Structure with Subsidiaries
 */
async function demoCorporateStructure() {
  console.log(chalk.blue('\n' + '═'.repeat(60)));
  console.log(chalk.blue.bold('    CORPORATE STRUCTURE WITH SUBSIDIARIES'));
  console.log(chalk.blue('═'.repeat(60)));

  const factory = new SubsidiaryFactory();
  const parentEntity = 'parent-corp-001';

  // Create holding company
  console.log(chalk.cyan('\n🏢 Creating Holding Company Structure...'));

  const holdingCompany = await factory.createSubsidiary({
    type: 'holding_company',
    parentEntity,
    name: 'Global Holdings LLC',
    purpose: 'Asset holding and management',
    jurisdiction: 'Delaware',
    capitalStructure: {
      authorizedCapital: ethers.parseEther('100000000'),
      paidInCapital: ethers.parseEther('10000000'),
      shares: [{
        holder: parentEntity,
        class: 'A',
        amount: ethers.parseEther('10000000'),
        percentage: 100,
        votingRights: true
      }]
    },
    governance: {
      boardComposition: [
        {
          entityId: 'director-1',
          role: 'director',
          appointedBy: parentEntity,
          term: { start: Date.now(), end: Date.now() + 3 * 365 * 24 * 3600 * 1000 },
          committees: ['audit', 'compensation']
        }
      ],
      votingThresholds: new Map([
        ['ordinary', 51],
        ['special', 75]
      ]),
      vetoRights: [],
      managementStructure: {
        ceo: 'executive-1',
        cfo: 'executive-2',
        officers: [],
        delegatedAuthority: new Map()
      },
      reportingRequirements: []
    },
    limitations: {
      permittedActivities: ['Investment', 'Asset management'],
      prohibitedActivities: ['Direct operations'],
      leverageLimits: {
        maxDebtToEquity: 2,
        maxDebtToAssets: 0.6,
        minInterestCoverage: 3
      }
    },
    dissolution: {
      triggers: [],
      windDownPeriod: 365,
      distributionWaterfall: [],
      survivalClauses: []
    }
  });

  console.log(chalk.green(`  ✓ Created holding company: ${holdingCompany.entityId.slice(0, 10)}...`));

  // Create operating subsidiary
  console.log(chalk.cyan('\n🏭 Creating Operating Subsidiary...'));

  const opSub = await factory.createSubsidiary({
    type: 'wholly_owned',
    parentEntity: holdingCompany.entityId,
    name: 'Operations Inc',
    purpose: 'Manufacturing and distribution',
    jurisdiction: 'Delaware',
    capitalStructure: {
      authorizedCapital: ethers.parseEther('50000000'),
      paidInCapital: ethers.parseEther('5000000'),
      shares: [{
        holder: holdingCompany.entityId,
        class: 'A',
        amount: ethers.parseEther('5000000'),
        percentage: 100,
        votingRights: true
      }]
    },
    governance: {
      boardComposition: [],
      votingThresholds: new Map([['all', 51]]),
      vetoRights: [],
      managementStructure: { delegatedAuthority: new Map() },
      reportingRequirements: [
        {
          type: 'financial',
          frequency: 'monthly',
          recipients: [holdingCompany.entityId]
        },
        {
          type: 'operational',
          frequency: 'weekly',
          recipients: [holdingCompany.entityId]
        }
      ]
    },
    limitations: {
      permittedActivities: ['Manufacturing', 'Sales', 'Distribution'],
      prohibitedActivities: ['Financial services'],
      concentrationLimits: [
        { type: 'customer', maxPercentage: 25 },
        { type: 'supplier', maxPercentage: 30 }
      ]
    },
    dissolution: {
      triggers: [],
      windDownPeriod: 180,
      distributionWaterfall: [],
      survivalClauses: []
    }
  });

  console.log(chalk.green(`  ✓ Created operating subsidiary: ${opSub.entityId.slice(0, 10)}...`));

  // Create SPV for specific transaction
  console.log(chalk.cyan('\n💼 Creating Special Purpose Vehicle...'));

  const spv = await factory.createSPV(
    holdingCompany.entityId,
    'Acquisition of Patent Portfolio',
    ethers.parseEther('1000000')
  );

  console.log(chalk.green(`  ✓ Created SPV: ${spv.entityId.slice(0, 10)}...`));
  console.log(chalk.gray(`    Purpose: ${spv.config.purpose}`));
  console.log(chalk.gray(`    Capital: ${ethers.formatEther(spv.config.capitalStructure.paidInCapital)} ETH`));

  // Create joint venture
  console.log(chalk.cyan('\n🤝 Creating Joint Venture...'));

  const jv = await factory.createJointVenture(
    [
      {
        entityId: holdingCompany.entityId,
        contribution: ethers.parseEther('3000000'),
        nominee: 'jv-director-1'
      },
      {
        entityId: 'partner-corp-001',
        contribution: ethers.parseEther('2000000'),
        nominee: 'jv-director-2'
      }
    ],
    {
      name: 'Strategic JV Partners LLC',
      purpose: 'Development of new technology platform',
      jurisdiction: 'Delaware'
    }
  );

  console.log(chalk.green(`  ✓ Created joint venture: ${jv.entityId.slice(0, 10)}...`));
  console.log(chalk.gray(`    Partners: 2`));
  console.log(chalk.gray(`    Total Capital: ${ethers.formatEther(ethers.parseEther('5000000'))} ETH`));
  console.log(chalk.gray(`    Ownership Split: 60% / 40%`));

  // Create series LLC
  console.log(chalk.cyan('\n📚 Creating Series LLC Structure...'));

  const seriesLLCs = await factory.createSeriesLLC(holdingCompany.entityId, 3);

  console.log(chalk.green(`  ✓ Created Series LLC with ${seriesLLCs.length} series`));
  for (let i = 1; i < seriesLLCs.length; i++) {
    console.log(chalk.gray(`    ${seriesLLCs[i].config.name}: ${seriesLLCs[i].entityId.slice(0, 10)}...`));
  }

  // List all subsidiaries
  const allSubs = factory.listSubsidiaries(holdingCompany.entityId);
  console.log(chalk.cyan(`\n📊 Total Subsidiaries of Holding Company: ${allSubs.length}`));
}

/**
 * Main demo runner
 */
async function main() {
  console.log(chalk.blue.bold('\n' + '═'.repeat(60)));
  console.log(chalk.blue.bold('         XLN ORGANIZATIONAL FEATURES DEMO'));
  console.log(chalk.blue.bold('═'.repeat(60)));

  try {
    // Run all demos
    await demoTechStartup();
    await demoFinancialInstitution();
    await demoCorporateStructure();

    console.log(chalk.green.bold('\n' + '═'.repeat(60)));
    console.log(chalk.green.bold('         ALL DEMOS COMPLETED SUCCESSFULLY'));
    console.log(chalk.green.bold('═'.repeat(60)));

    console.log(chalk.white('\n🎯 Key Features Demonstrated:'));
    console.log(chalk.gray('  • Dual-class share structures with sunset provisions'));
    console.log(chalk.gray('  • Sophisticated risk committees with circuit breakers'));
    console.log(chalk.gray('  • Complex subsidiary structures (SPVs, JVs, Series LLCs)'));
    console.log(chalk.gray('  • Vesting schedules and transfer restrictions'));
    console.log(chalk.gray('  • Multi-level governance and authority delegation'));

    console.log(chalk.white('\n💡 Use Cases:'));
    console.log(chalk.gray('  • Tech startups maintaining founder control'));
    console.log(chalk.gray('  • Financial institutions managing risk'));
    console.log(chalk.gray('  • Corporations optimizing tax and liability'));
    console.log(chalk.gray('  • Joint ventures between multiple entities'));
    console.log(chalk.gray('  • Asset segregation through series structures'));

  } catch (error) {
    console.error(chalk.red('\n❌ Demo failed:'), error);
    process.exit(1);
  }
}

// Run demo
main().catch(console.error);