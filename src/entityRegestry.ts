export interface EntityRegistry {
    entities: Map<string, EntityProfile>;
  }
  
  export interface EntityProfile {
    entityId: string;
    quorum: Array<[number, number]>; // [signerIndex, weight]
    threshold: number; // 0.67 for 67%
    proposer: number; // First signer by default
  }
  
  export class EntityDirectory {
    private registry: EntityRegistry = { entities: new Map() };
    
    register(profile: EntityProfile): void {
      this.registry.entities.set(profile.entityId, profile);
    }
    
    getProfile(entityId: string): EntityProfile | undefined {
      return this.registry.entities.get(entityId);
    }
    
    getProposer(entityId: string): number | undefined {
      const profile = this.getProfile(entityId);
      return profile?.proposer ?? profile?.quorum[0]?.[0];
    }
    
    isInQuorum(entityId: string, signerIndex: number): boolean {
      const profile = this.getProfile(entityId);
      if (!profile) return false;
      return profile.quorum.some(([signer, _]) => signer === signerIndex);
    }
  }