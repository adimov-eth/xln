export interface ISubchannel {
  chainId: string;
  tokenId: string;
  capacity: string;
  balance: string;
  status: 'active' | 'closed';
  createdAt: Date;
  updatedAt: Date;
}

export interface IChannel {
  channelId: string;
  userA: string;
  userB: string;
  subchannels: ISubchannel[];
  status: 'active' | 'closed';
  createdAt: Date;
  updatedAt: Date;
}

export interface ICreateChannelRequest {
  userA: string;
  userB: string;
}

export interface ICreateChannelResponse {
  channel: IChannel;
}

export interface IGetChannelResponse {
  channel: IChannel;
}
