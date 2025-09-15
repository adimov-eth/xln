/**
 * Subsidiary Factory for XLN Entities
 *
 * Enables sophisticated organizational structures:
 * 1. Wholly-owned subsidiaries
 * 2. Joint ventures
 * 3. Special purpose vehicles (SPVs)
 * 4. Holding company structures
 * 5. Series LLCs
 */

import { ethers } from 'ethers';
import { EntityState, EntityTx, ConsensusConfig } from '../types.js';
import { generateLazyEntityId, hashBoard } from '../entity-factory.js';
import { DualClassShares, ShareClass } from './DualClassShares.js';
import { RiskCommittee } from './RiskCommittee.js';

export interface SubsidiaryConfig {
  type: SubsidiaryType;
  parentEntity: string;
  name: string;
  purpose: string;
  jurisdiction: string;
  capitalStructure: CapitalStructure;
  governance: GovernanceStructure;
  limitations: OperationalLimitations;
  dissolution: DissolutionTerms;
}

export type SubsidiaryType =
  | 'wholly_owned'
  | 'joint_venture'
  | 'spv'
  | 'holding_company'
  | 'series_llc'
  | 'trust'
  | 'foundation';

export interface CapitalStructure {
  authorizedCapital: bigint;
  paidInCapital: bigint;
  shares: ShareAllocation[];
  debtInstruments?: DebtInstrument[];
  preferredTerms?: PreferredTerms;
}

export interface ShareAllocation {
  holder: string; // Entity ID or address
  class: string;
  amount: bigint;
  percentage: number;
  votingRights: boolean;
  transferRestrictions?: string[];
}

export interface DebtInstrument {
  type: 'bond' | 'note' | 'convertible' | 'loan';
  principal: bigint;
  interestRate: number; // Annual percentage
  maturityDate: number;
  secured: boolean;
  convertible?: {
    conversionPrice: bigint;
    conversionRatio: number;
    forcedConversion?: bigint; // Price trigger
  };
}

export interface PreferredTerms {
  liquidationPreference: number; // Multiple (e.g., 1x, 2x)
  cumulative: boolean;
  participating: boolean;
  dividendRate: number;
  redemptionRights: {
    redeemable: boolean;
    redemptionDate?: number;
    redemptionPrice?: bigint;
  };
}

export interface GovernanceStructure {
  boardComposition: BoardMember[];
  votingThresholds: Map<string, number>;
  vetoRights: VetoRight[];
  managementStructure: ManagementStructure;
  reportingRequirements: ReportingRequirement[];
}

export interface BoardMember {
  entityId: string;
  role: 'director' | 'independent' | 'observer';
  appointedBy: string;
  term: {
    start: number;
    end: number;
  };
  committees: string[];
}

export interface VetoRight {
  holder: string;
  matters: string[]; // e.g., 'budget', 'strategy', 'key_hires'
  threshold?: number; // Override threshold for specific matters
}

export interface ManagementStructure {
  ceo?: string;
  cfo?: string;
  officers: Officer[];
  delegatedAuthority: Map<string, AuthorityLimit>;
}

export interface Officer {
  entityId: string;
  title: string;
  responsibilities: string[];
  compensationPackage?: CompensationPackage;
}

export interface CompensationPackage {
  baseSalary: bigint;
  bonus?: BonusStructure;
  equity?: EquityGrant;
  benefits?: string[];
}

export interface BonusStructure {
  target: bigint;
  maxMultiple: number;
  kpis: string[];
}

export interface EquityGrant {
  type: 'options' | 'restricted_stock' | 'phantom';
  amount: bigint;
  vestingSchedule: string;
  exercisePrice?: bigint;
}

export interface AuthorityLimit {
  category: string;
  limit: bigint;
  requiresApproval: string[]; // Entity IDs that must approve
}

export interface ReportingRequirement {
  type: 'financial' | 'operational' | 'compliance' | 'strategic';
  frequency: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual';
  recipients: string[];
  template?: string;
}

export interface OperationalLimitations {
  permittedActivities: string[];
  prohibitedActivities: string[];
  geographicRestrictions?: string[];
  counterpartyRestrictions?: string[];
  leverageLimits?: LeverageLimit;
  concentrationLimits?: ConcentrationLimit[];
}

export interface LeverageLimit {
  maxDebtToEquity: number;
  maxDebtToAssets: number;
  minInterestCoverage: number;
}

export interface ConcentrationLimit {
  type: 'customer' | 'supplier' | 'asset' | 'geographic';
  maxPercentage: number;
}

export interface DissolutionTerms {
  triggers: DissolutionTrigger[];
  windDownPeriod: number; // Days
  distributionWaterfall: DistributionTier[];
  survivalClauses: string[]; // Clauses that survive dissolution
}

export interface DissolutionTrigger {
  type: 'date' | 'event' | 'vote' | 'regulatory' | 'financial';
  condition: any;
  automaticWinding: boolean;
}

export interface DistributionTier {
  priority: number;
  recipients: string[];
  allocation: 'pro_rata' | 'fixed' | 'waterfall';
  amount?: bigint; // For fixed allocations
}

/**
 * Factory for creating and managing subsidiary entities
 */
export class SubsidiaryFactory {
  private subsidiaries: Map<string, Subsidiary> = new Map();
  private templates: Map<string, SubsidiaryConfig> = new Map();

  constructor() {
    this.initializeTemplates();
  }

  /**
   * Initialize standard subsidiary templates
   */
  private initializeTemplates(): void {
    // SPV template for isolated transactions
    this.templates.set('spv_template', {
      type: 'spv',
      parentEntity: '',
      name: 'Special Purpose Vehicle',
      purpose: 'Isolated transaction execution',
      jurisdiction: 'Delaware',
      capitalStructure: {
        authorizedCapital: ethers.parseEther('1000000'),
        paidInCapital: ethers.parseEther('100'),
        shares: []
      },
      governance: {
        boardComposition: [],
        votingThresholds: new Map([
          ['ordinary', 51],
          ['special', 75],
          ['unanimous', 100]
        ]),
        vetoRights: [],
        managementStructure: {
          delegatedAuthority: new Map()
        },
        reportingRequirements: [
          {
            type: 'financial',
            frequency: 'monthly',
            recipients: []
          }
        ]
      },
      limitations: {
        permittedActivities: ['Specific transaction only'],
        prohibitedActivities: ['All other business'],
        leverageLimits: {
          maxDebtToEquity: 3,
          maxDebtToAssets: 0.75,
          minInterestCoverage: 2
        }
      },
      dissolution: {
        triggers: [
          {
            type: 'event',
            condition: 'Transaction completion',
            automaticWinding: true
          }
        ],
        windDownPeriod: 90,
        distributionWaterfall: [],
        survivalClauses: ['Confidentiality', 'Indemnification']
      }
    });

    // Joint venture template
    this.templates.set('jv_template', {
      type: 'joint_venture',
      parentEntity: '',
      name: 'Joint Venture',
      purpose: 'Strategic partnership',
      jurisdiction: 'Delaware',
      capitalStructure: {
        authorizedCapital: ethers.parseEther('10000000'),
        paidInCapital: ethers.parseEther('1000000'),
        shares: []
      },
      governance: {
        boardComposition: [],
        votingThresholds: new Map([
          ['ordinary', 51],
          ['deadlock', 50],
          ['special', 67]
        ]),
        vetoRights: [],
        managementStructure: {
          delegatedAuthority: new Map([
            ['operational', { category: 'operational', limit: ethers.parseEther('100000'), requiresApproval: [] }],
            ['strategic', { category: 'strategic', limit: ethers.parseEther('1000000'), requiresApproval: ['board'] }]
          ])
        },
        reportingRequirements: [
          {
            type: 'operational',
            frequency: 'weekly',
            recipients: []
          },
          {
            type: 'financial',
            frequency: 'quarterly',
            recipients: []
          }
        ]
      },
      limitations: {
        permittedActivities: ['Core business activities'],
        prohibitedActivities: ['Competing ventures'],
        concentrationLimits: [
          { type: 'customer', maxPercentage: 30 },
          { type: 'supplier', maxPercentage: 40 }
        ]
      },
      dissolution: {
        triggers: [
          {
            type: 'vote',
            condition: { threshold: 75 },
            automaticWinding: false
          },
          {
            type: 'date',
            condition: Date.now() + 5 * 365 * 24 * 3600 * 1000, // 5 years
            automaticWinding: false
          }
        ],
        windDownPeriod: 180,
        distributionWaterfall: [],
        survivalClauses: ['IP licenses', 'Non-compete', 'Confidentiality']
      }
    });
  }

  /**
   * Create a new subsidiary
   */
  async createSubsidiary(config: SubsidiaryConfig): Promise<Subsidiary> {
    // Generate entity ID for subsidiary
    const entityId = this.generateSubsidiaryId(config);

    // Create consensus configuration
    const consensusConfig = this.createConsensusConfig(config);

    // Initialize subsidiary
    const subsidiary = new Subsidiary(entityId, config, consensusConfig);

    // Set up governance
    await subsidiary.setupGovernance();

    // Initialize capital structure
    await subsidiary.initializeCapital();

    // Set up risk management
    if (config.type === 'spv' || config.type === 'joint_venture') {
      await subsidiary.setupRiskManagement();
    }

    // Register subsidiary
    this.subsidiaries.set(entityId, subsidiary);

    // Create formation transaction
    const formationTx: EntityTx = {
      type: 'subsidiary_formation',
      from: config.parentEntity,
      data: {
        subsidiaryId: entityId,
        type: config.type,
        name: config.name,
        purpose: config.purpose,
        jurisdiction: config.jurisdiction,
        authorizedCapital: config.capitalStructure.authorizedCapital.toString(),
        governance: this.serializeGovernance(config.governance)
      },
      timestamp: Date.now(),
      nonce: Date.now()
    };

    return subsidiary;
  }

  /**
   * Create a joint venture between multiple entities
   */
  async createJointVenture(
    partners: JointVenturePartner[],
    config: Partial<SubsidiaryConfig>
  ): Promise<Subsidiary> {
    // Merge config with JV template
    const jvConfig: SubsidiaryConfig = {
      ...this.templates.get('jv_template')!,
      ...config,
      type: 'joint_venture',
      parentEntity: partners[0].entityId // Primary partner
    };

    // Allocate shares based on partner contributions
    jvConfig.capitalStructure.shares = partners.map(partner => ({
      holder: partner.entityId,
      class: 'A',
      amount: partner.contribution,
      percentage: Number(partner.contribution * 100n / jvConfig.capitalStructure.paidInCapital),
      votingRights: true,
      transferRestrictions: ['right_of_first_refusal', 'tag_along', 'drag_along']
    }));

    // Set up board with partner representatives
    jvConfig.governance.boardComposition = partners.map(partner => ({
      entityId: partner.nominee,
      role: 'director' as const,
      appointedBy: partner.entityId,
      term: {
        start: Date.now(),
        end: Date.now() + 365 * 24 * 3600 * 1000 // 1 year
      },
      committees: []
    }));

    // Add veto rights for minority partners
    const minorityPartners = partners.filter(p =>
      p.contribution * 2n < jvConfig.capitalStructure.paidInCapital
    );

    jvConfig.governance.vetoRights = minorityPartners.map(partner => ({
      holder: partner.entityId,
      matters: ['budget', 'strategy', 'key_hires', 'debt', 'M&A']
    }));

    return this.createSubsidiary(jvConfig);
  }

  /**
   * Create a special purpose vehicle
   */
  async createSPV(
    parentEntity: string,
    purpose: string,
    capitalRequirement: bigint
  ): Promise<Subsidiary> {
    const spvConfig: SubsidiaryConfig = {
      ...this.templates.get('spv_template')!,
      parentEntity,
      name: `SPV-${Date.now()}`,
      purpose,
      capitalStructure: {
        ...this.templates.get('spv_template')!.capitalStructure,
        paidInCapital: capitalRequirement,
        shares: [{
          holder: parentEntity,
          class: 'A',
          amount: capitalRequirement,
          percentage: 100,
          votingRights: true
        }]
      }
    };

    // Add automatic dissolution after purpose completion
    spvConfig.dissolution.triggers.push({
      type: 'event',
      condition: { event: 'purpose_completed', description: purpose },
      automaticWinding: true
    });

    return this.createSubsidiary(spvConfig);
  }

  /**
   * Create a series LLC structure
   */
  async createSeriesLLC(
    parentEntity: string,
    seriesCount: number
  ): Promise<Subsidiary[]> {
    const series: Subsidiary[] = [];

    // Create master LLC
    const masterConfig: SubsidiaryConfig = {
      type: 'series_llc',
      parentEntity,
      name: `Series LLC Master-${Date.now()}`,
      purpose: 'Asset segregation and liability isolation',
      jurisdiction: 'Delaware',
      capitalStructure: {
        authorizedCapital: ethers.parseEther('100000000'),
        paidInCapital: ethers.parseEther('1000'),
        shares: [{
          holder: parentEntity,
          class: 'Master',
          amount: ethers.parseEther('1000'),
          percentage: 100,
          votingRights: true
        }]
      },
      governance: {
        boardComposition: [],
        votingThresholds: new Map([['all', 51]]),
        vetoRights: [],
        managementStructure: { delegatedAuthority: new Map() },
        reportingRequirements: []
      },
      limitations: {
        permittedActivities: ['Series management'],
        prohibitedActivities: ['Direct operations']
      },
      dissolution: {
        triggers: [],
        windDownPeriod: 365,
        distributionWaterfall: [],
        survivalClauses: []
      }
    };

    const master = await this.createSubsidiary(masterConfig);
    series.push(master);

    // Create individual series
    for (let i = 0; i < seriesCount; i++) {
      const seriesConfig: SubsidiaryConfig = {
        ...masterConfig,
        name: `Series ${String.fromCharCode(65 + i)}`, // Series A, B, C...
        purpose: `Segregated assets and operations for Series ${String.fromCharCode(65 + i)}`,
        parentEntity: master.entityId,
        capitalStructure: {
          authorizedCapital: ethers.parseEther('10000000'),
          paidInCapital: ethers.parseEther('100'),
          shares: [{
            holder: master.entityId,
            class: 'Series',
            amount: ethers.parseEther('100'),
            percentage: 100,
            votingRights: false // Controlled by master
          }]
        }
      };

      const seriesEntity = await this.createSubsidiary(seriesConfig);
      series.push(seriesEntity);
    }

    return series;
  }

  /**
   * Generate subsidiary entity ID
   */
  private generateSubsidiaryId(config: SubsidiaryConfig): string {
    const data = {
      parent: config.parentEntity,
      type: config.type,
      name: config.name,
      timestamp: Date.now()
    };

    return hashBoard(JSON.stringify(data));
  }

  /**
   * Create consensus configuration for subsidiary
   */
  private createConsensusConfig(config: SubsidiaryConfig): ConsensusConfig {
    const validators = config.governance.boardComposition.map(b => b.entityId);
    const shares: Record<string, bigint> = {};

    // Assign voting weights based on board composition
    for (const member of config.governance.boardComposition) {
      shares[member.entityId] = 100n; // Equal weight by default
    }

    return {
      validators,
      shares,
      threshold: BigInt(config.governance.votingThresholds.get('ordinary') || 51)
    };
  }

  /**
   * Serialize governance structure for storage
   */
  private serializeGovernance(governance: GovernanceStructure): any {
    return {
      board: governance.boardComposition,
      thresholds: Object.fromEntries(governance.votingThresholds),
      vetoRights: governance.vetoRights,
      management: governance.managementStructure,
      reporting: governance.reportingRequirements
    };
  }

  /**
   * Get subsidiary by ID
   */
  getSubsidiary(entityId: string): Subsidiary | undefined {
    return this.subsidiaries.get(entityId);
  }

  /**
   * List all subsidiaries of a parent
   */
  listSubsidiaries(parentEntity: string): Subsidiary[] {
    return Array.from(this.subsidiaries.values()).filter(
      s => s.config.parentEntity === parentEntity
    );
  }
}

/**
 * Subsidiary entity class
 */
export class Subsidiary {
  public readonly entityId: string;
  public readonly config: SubsidiaryConfig;
  private consensusConfig: ConsensusConfig;
  private shareSystem?: DualClassShares;
  private riskCommittee?: RiskCommittee;
  private state: SubsidiaryState = 'forming';
  private financials: FinancialState;
  private contracts: Map<string, Contract> = new Map();

  constructor(
    entityId: string,
    config: SubsidiaryConfig,
    consensusConfig: ConsensusConfig
  ) {
    this.entityId = entityId;
    this.config = config;
    this.consensusConfig = consensusConfig;
    this.financials = {
      assets: 0n,
      liabilities: 0n,
      equity: config.capitalStructure.paidInCapital,
      revenue: 0n,
      expenses: 0n,
      netIncome: 0n
    };
  }

  /**
   * Set up governance structure
   */
  async setupGovernance(): Promise<void> {
    // Initialize board
    console.log(`Setting up board with ${this.config.governance.boardComposition.length} members`);

    // Set up committees if needed
    if (this.config.type === 'joint_venture' || this.config.type === 'holding_company') {
      // Audit committee, compensation committee, etc.
    }

    this.state = 'active';
  }

  /**
   * Initialize capital structure
   */
  async initializeCapital(): Promise<void> {
    // Issue initial shares
    for (const allocation of this.config.capitalStructure.shares) {
      console.log(`Issuing ${allocation.amount} ${allocation.class} shares to ${allocation.holder}`);
    }

    // Set up debt instruments if any
    if (this.config.capitalStructure.debtInstruments) {
      for (const debt of this.config.capitalStructure.debtInstruments) {
        this.financials.liabilities += debt.principal;
      }
    }
  }

  /**
   * Set up risk management
   */
  async setupRiskManagement(): Promise<void> {
    this.riskCommittee = new RiskCommittee(this.entityId);
    console.log('Risk committee established');
  }

  /**
   * Execute business operations
   */
  async executeOperation(operation: BusinessOperation): Promise<OperationResult> {
    // Check operational limitations
    if (!this.isOperationPermitted(operation)) {
      throw new Error(`Operation not permitted: ${operation.type}`);
    }

    // Check authority limits
    if (!this.hasAuthority(operation)) {
      throw new Error('Exceeds authority limits');
    }

    // Execute operation
    const result = await this.performOperation(operation);

    // Update financials
    this.updateFinancials(result);

    return result;
  }

  /**
   * Check dissolution triggers
   */
  async checkDissolutionTriggers(): Promise<boolean> {
    for (const trigger of this.config.dissolution.triggers) {
      if (await this.evaluateDissolutionTrigger(trigger)) {
        if (trigger.automaticWinding) {
          await this.initiateWindDown();
        }
        return true;
      }
    }
    return false;
  }

  /**
   * Initiate wind down process
   */
  private async initiateWindDown(): Promise<void> {
    this.state = 'winding_down';
    console.log(`Initiating wind down with ${this.config.dissolution.windDownPeriod} day period`);

    // Notify stakeholders
    // Liquidate assets
    // Pay creditors
    // Distribute remaining assets per waterfall
  }

  /**
   * Helper methods
   */
  private isOperationPermitted(operation: BusinessOperation): boolean {
    const limitations = this.config.limitations;

    // Check permitted activities
    if (!limitations.permittedActivities.some(a =>
      operation.description.includes(a)
    )) {
      return false;
    }

    // Check prohibited activities
    if (limitations.prohibitedActivities.some(a =>
      operation.description.includes(a)
    )) {
      return false;
    }

    return true;
  }

  private hasAuthority(operation: BusinessOperation): boolean {
    const authority = this.config.governance.managementStructure.delegatedAuthority;
    const limit = authority.get(operation.category);

    if (!limit) return false;

    return operation.value <= limit.limit;
  }

  private async performOperation(operation: BusinessOperation): Promise<OperationResult> {
    // Simulate operation execution
    return {
      success: true,
      value: operation.value,
      impact: {
        revenue: operation.type === 'sale' ? operation.value : 0n,
        expenses: operation.type === 'purchase' ? operation.value : 0n
      }
    };
  }

  private updateFinancials(result: OperationResult): void {
    if (result.impact.revenue) {
      this.financials.revenue += result.impact.revenue;
    }
    if (result.impact.expenses) {
      this.financials.expenses += result.impact.expenses;
    }
    this.financials.netIncome = this.financials.revenue - this.financials.expenses;
  }

  private async evaluateDissolutionTrigger(trigger: DissolutionTrigger): Promise<boolean> {
    switch (trigger.type) {
      case 'date':
        return Date.now() >= trigger.condition;
      case 'financial':
        return this.financials.netIncome < trigger.condition.minIncome;
      default:
        return false;
    }
  }
}

// Supporting types
interface JointVenturePartner {
  entityId: string;
  contribution: bigint;
  nominee: string; // Board nominee
}

type SubsidiaryState = 'forming' | 'active' | 'suspended' | 'winding_down' | 'dissolved';

interface FinancialState {
  assets: bigint;
  liabilities: bigint;
  equity: bigint;
  revenue: bigint;
  expenses: bigint;
  netIncome: bigint;
}

interface Contract {
  id: string;
  type: string;
  counterparty: string;
  value: bigint;
  terms: any;
}

interface BusinessOperation {
  type: 'sale' | 'purchase' | 'investment' | 'distribution';
  category: string;
  description: string;
  value: bigint;
  counterparty?: string;
}

interface OperationResult {
  success: boolean;
  value: bigint;
  impact: {
    revenue?: bigint;
    expenses?: bigint;
  };
}