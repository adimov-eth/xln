/**
 * Environment configuration for old_src channel system
 */

export interface HubData {
  name: string;
  host: string;
  port: number;
  address: string;
  publicKey: string;
}

interface ENV {
  hubAddress: string;
  hubDataList: HubData[];
  wsPort: number;
  network: string;
  privateKey?: string;
  debug: boolean;
}

const ENV: ENV = {
  hubAddress: '',
  hubDataList: [],
  wsPort: 8080,
  network: 'local',
  debug: process.env.DEBUG === 'true'
};

export default ENV;