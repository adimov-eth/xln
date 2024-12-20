import { expect, use } from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { Channel, ChannelError, IChannelState, ISubchannel } from '../core/Channel';
import { ethers } from 'ethers';
import fs from 'fs';

use(chaiAsPromised);

const getSubchannelId = (state: IChannelState) => 
  ethers.solidityPackedKeccak256(
    ['string', 'uint256', 'string'],
    [state.channelId, 1, '0x1234']
  );

describe('Channel', () => {
  const TEST_DB_PATH = './test-channel-db';
  const userWallet = ethers.Wallet.createRandom();
  const peerWallet = ethers.Wallet.createRandom();
  let channel: Channel;

  beforeEach(async () => {
    // Clean up test database if it exists
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    }

    channel = new Channel(userWallet.address, peerWallet.address, {
      dbPath: TEST_DB_PATH,
    });
    await channel.initialize();
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.rmSync(TEST_DB_PATH, { recursive: true, force: true });
    }
  });

  describe('initialization', () => {
    it('should create a channel with valid addresses', async () => {
      const state = channel.getState();
      expect(state.channelId).to.be.a('string');
      expect(Object.keys(state.subchannels)).to.have.length(0);
      expect(state.nonce).to.equal(0);
      expect(state.signatures).to.be.empty;
    });

    it('should throw error when creating channel with self', () => {
      expect(() => new Channel(userWallet.address, userWallet.address)).to.throw(
        ChannelError,
        'Cannot create channel with self',
      );
    });

    it('should order addresses correctly', () => {
      const state = channel.getState();
      const [expectedLeft, expectedRight] =
        userWallet.address < peerWallet.address
          ? [userWallet.address, peerWallet.address]
          : [peerWallet.address, userWallet.address];

      expect(state.left).to.equal(expectedLeft.toLowerCase());
      expect(state.right).to.equal(expectedRight.toLowerCase());
    });
  });

  describe('subchannel management', () => {
    it('should open a new subchannel', async () => {
      const state = channel.getState();
      const subchannelId = getSubchannelId(state);

      await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      });

      const subchannel = channel.getSubchannel(subchannelId);
      expect(subchannel).to.not.be.undefined;
      if (subchannel) {
        expect(subchannel.id).to.equal(subchannelId);
        expect(subchannel.status).to.equal('active');
        expect(subchannel.balance).to.equal('0');
        expect(subchannel.nonce).to.equal(0);
      }

      const newState = channel.getState();
      expect(Object.keys(newState.subchannels)).to.have.length(1);
      expect(newState.merkleRoot).to.be.a('string');
    });

    it('should update subchannel balance', async () => {
      const state = channel.getState();
      const subchannelId = getSubchannelId(state);

      await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      });

      await channel.updateBalance({
        subchannelId,
        newBalance: '500',
      });

      const updated = channel.getSubchannel(subchannelId);
      expect(updated).to.not.be.undefined;
      if (updated) {
        expect(updated.balance).to.equal('500');
        expect(updated.nonce).to.equal(1);
      }
    });

    it('should not allow balance to exceed capacity', async () => {
      const state = channel.getState();
      const subchannelId = getSubchannelId(state);

      await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      });

      await expect(
        channel.updateBalance({
          subchannelId,
          newBalance: '1001',
        }),
      ).to.be.rejectedWith(ChannelError, 'Balance exceeds capacity');
    });

    it('should close a subchannel', async () => {
      const state = channel.getState();
      const subchannelId = getSubchannelId(state);

      await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      });

      await channel.closeSubchannel(subchannelId);
      const closed = channel.getSubchannel(subchannelId);
      expect(closed).to.not.be.undefined;
      if (closed) {
        expect(closed.status).to.equal('closed');
      }
    });

    it('should not update closed subchannel', async () => {
      const state = channel.getState();
      const subchannelId = getSubchannelId(state);

      await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      });

      await channel.closeSubchannel(subchannelId);

      await expect(
        channel.updateBalance({
          subchannelId,
          newBalance: '500',
        }),
      ).to.be.rejectedWith(ChannelError, 'Subchannel is not active');
    });
  });

  describe('state management', () => {
    it('should maintain state history', async () => {
      const state1 = channel.getState();
      const subchannelId = getSubchannelId(state1);

      await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      });

      await channel.updateBalance({
        subchannelId,
        newBalance: '500',
      });

      const state2 = channel.getState();
      expect(state2.nonce).to.be.greaterThan(state1.nonce);
    });

    it('should update merkle root on state changes', async () => {
      const state1 = channel.getState();
      
      await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      });

      const state2 = channel.getState();
      expect(state2.merkleRoot).to.not.equal(state1.merkleRoot);

      const subchannelId = getSubchannelId(state2);

      await channel.updateBalance({
        subchannelId,
        newBalance: '500',
      });

      const state3 = channel.getState();
      expect(state3.merkleRoot).to.not.equal(state2.merkleRoot);
    });
  });

  describe('error handling', () => {
    it('should handle invalid subchannel ID', async () => {
      await expect(
        channel.updateBalance({
          subchannelId: 'invalid-id',
          newBalance: '500',
        }),
      ).to.be.rejectedWith(ChannelError, 'Subchannel not found');
    });

    it('should handle database errors', async () => {
      // Simulate database error by using invalid path
      const invalidChannel = new Channel(userWallet.address, peerWallet.address, {
        dbPath: '/invalid/path/to/db',
      });

      await expect(invalidChannel.initialize()).to.be.rejectedWith(ChannelError, 'Failed to initialize channel');
    });
  });
});
