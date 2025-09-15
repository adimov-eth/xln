/**
 * XLN Organizational Primitives
 *
 * Export all organizational features for sophisticated entity structures
 */

export * from './DualClassShares.js';
export * from './RiskCommittee.js';
export * from './SubsidiaryFactory.js';

// Re-export commonly used types
export type {
  ShareClass,
  Shareholder,
  VestingSchedule,
  SunsetProvision,
  VotingAgreement,
  TransferRestriction,
  ConversionRight,
  ConversionTrigger
} from './DualClassShares.js';

export type {
  RiskCommitteeMember,
  RiskSpecialization,
  RiskPolicy,
  RiskLimit,
  RiskTrigger,
  RiskAction,
  RiskExposure,
  RiskIncident,
  CircuitBreaker
} from './RiskCommittee.js';

export type {
  SubsidiaryConfig,
  SubsidiaryType,
  CapitalStructure,
  GovernanceStructure,
  OperationalLimitations,
  DissolutionTerms,
  BoardMember,
  Officer,
  CompensationPackage
} from './SubsidiaryFactory.js';