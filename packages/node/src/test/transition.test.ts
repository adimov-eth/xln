import { expect } from 'chai';
import { ethers } from 'ethers';
import { Channel } from '../core/Channel';
import {
  TransitionType,
  TransitionError,
  PaymentCreateTransition,
  PaymentSettleTransition,
  SubchannelCreateTransition,
  createTransition,
  PaymentCancelTransition,
  SwapCreateTransition,
  SwapSettleTransition,
  SubchannelUpdateTransition,
  SubchannelCloseTransition,
} from '../core/Transition';
import fs from 'fs';

describe('Transitions', () => {
  const TEST_DB_PATH = './test-transition-db';
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

  describe('PaymentCreateTransition', () => {
    let subchannel: Awaited<ReturnType<typeof channel.openSubchannel>>;

    beforeEach(async () => {
      subchannel = await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      });
    });

    it('should create a payment successfully', async () => {
      const transition = new PaymentCreateTransition(
        1,
        '0x1234',
        '500',
        ethers.keccak256(ethers.toUtf8Bytes('secret')),
        Math.floor(Date.now() / 1000) + 3600,
        'encrypted_data',
      );

      await expect(transition.apply(channel)).to.not.be.rejected;
      const updatedSubchannel = channel.getSubchannel(subchannel.id);
      expect(updatedSubchannel?.balance).to.equal('500');
    });

    it('should fail if payment exceeds capacity', async () => {
      const transition = new PaymentCreateTransition(
        1,
        '0x1234',
        '1001',
        ethers.keccak256(ethers.toUtf8Bytes('secret')),
        Math.floor(Date.now() / 1000) + 3600,
        'encrypted_data',
      );

      await expect(transition.apply(channel)).to.be.rejectedWith(TransitionError, 'Payment exceeds capacity');
    });

    it('should verify valid payment', async () => {
      const transition = new PaymentCreateTransition(
        1,
        '0x1234',
        '500',
        ethers.keccak256(ethers.toUtf8Bytes('secret')),
        Math.floor(Date.now() / 1000) + 3600,
        'encrypted_data',
      );

      expect(await transition.verify(channel)).to.be.true;
    });

    it('should not verify invalid payment', async () => {
      const transition = new PaymentCreateTransition(
        1,
        '0x1234',
        '1001',
        ethers.keccak256(ethers.toUtf8Bytes('secret')),
        Math.floor(Date.now() / 1000) + 3600,
        'encrypted_data',
      );

      expect(await transition.verify(channel)).to.be.false;
    });
  });

  describe('PaymentSettleTransition', () => {
    let subchannel: Awaited<ReturnType<typeof channel.openSubchannel>>;
    const secret = 'test_secret';
    const amount = '500';

    beforeEach(async () => {
      subchannel = await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      });

      // Create initial payment
      const createTransition = new PaymentCreateTransition(
        1,
        '0x1234',
        amount,
        ethers.keccak256(ethers.toUtf8Bytes(secret)),
        Math.floor(Date.now() / 1000) + 3600,
        'encrypted_data',
      );

      await createTransition.apply(channel);
    });

    it('should settle payment successfully', async () => {
      const transition = new PaymentSettleTransition(1, '0x1234', amount, secret);

      await expect(transition.apply(channel)).to.not.be.rejected;
      const updatedSubchannel = channel.getSubchannel(subchannel.id);
      expect(updatedSubchannel?.balance).to.equal('0');
    });

    it('should fail if subchannel not found', async () => {
      const transition = new PaymentSettleTransition(2, '0x5678', amount, secret);

      await expect(transition.apply(channel)).to.be.rejectedWith(TransitionError, 'Subchannel not found');
    });

    it('should verify valid settlement', async () => {
      const transition = new PaymentSettleTransition(1, '0x1234', amount, secret);
      expect(await transition.verify(channel)).to.be.true;
    });

    it('should not verify invalid settlement', async () => {
      const transition = new PaymentSettleTransition(1, '0x1234', '1001', secret);
      expect(await transition.verify(channel)).to.be.false;
    });
  });

  describe('SubchannelCreateTransition', () => {
    it('should create subchannel successfully', async () => {
      const transition = new SubchannelCreateTransition(1, '0x1234', '1000');

      await expect(transition.apply(channel)).to.not.be.rejected;
      const state = channel.getState();
      expect(state.subchannels).to.have.lengthOf(1);
      expect(state.subchannels[0].capacity).to.equal('1000');
    });

    it('should verify new subchannel creation', async () => {
      const transition = new SubchannelCreateTransition(1, '0x1234', '1000');
      expect(await transition.verify(channel)).to.be.true;
    });

    it('should not verify duplicate subchannel creation', async () => {
      const transition = new SubchannelCreateTransition(1, '0x1234', '1000');
      await transition.apply(channel);
      expect(await transition.verify(channel)).to.be.false;
    });
  });

  describe('createTransition factory', () => {
    it('should create PaymentCreateTransition', () => {
      const params = {
        chainId: 1,
        tokenId: '0x1234',
        amount: '500',
        hashlock: ethers.keccak256(ethers.toUtf8Bytes('secret')),
        timelock: Math.floor(Date.now() / 1000) + 3600,
        encryptedData: 'encrypted_data',
      };

      const transition = createTransition(TransitionType.PAYMENT_CREATE, params);
      expect(transition).to.be.instanceOf(PaymentCreateTransition);
    });

    it('should create PaymentSettleTransition', () => {
      const params = {
        chainId: 1,
        tokenId: '0x1234',
        amount: '500',
        secret: 'secret',
      };

      const transition = createTransition(TransitionType.PAYMENT_SETTLE, params);
      expect(transition).to.be.instanceOf(PaymentSettleTransition);
    });

    it('should create SubchannelCreateTransition', () => {
      const params = {
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      };

      const transition = createTransition(TransitionType.SUBCHANNEL_CREATE, params);
      expect(transition).to.be.instanceOf(SubchannelCreateTransition);
    });

    it('should throw error for unsupported transition type', () => {
      expect(() => createTransition('UNSUPPORTED' as TransitionType, {})).to.throw(
        TransitionError,
        'Unsupported transition type',
      );
    });
  });

  describe('error handling', () => {
    it('should handle null channel', async () => {
      const transition = new PaymentCreateTransition(
        1,
        '0x1234',
        '500',
        ethers.keccak256(ethers.toUtf8Bytes('secret')),
        Math.floor(Date.now() / 1000) + 3600,
        'encrypted_data',
      );

      await expect(transition.apply(null as any)).to.be.rejectedWith(TransitionError, 'Channel is required');
    });

    it('should handle invalid parameters', () => {
      expect(() =>
        createTransition(TransitionType.PAYMENT_CREATE, {
          // Missing required parameters
        }),
      ).to.throw();
    });

    it('should handle closed subchannel', async () => {
      const subchannel = await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      });

      await channel.closeSubchannel(subchannel.id);

      const transition = new PaymentCreateTransition(
        1,
        '0x1234',
        '500',
        ethers.keccak256(ethers.toUtf8Bytes('secret')),
        Math.floor(Date.now() / 1000) + 3600,
        'encrypted_data',
      );

      await expect(transition.apply(channel)).to.be.rejectedWith(TransitionError, 'Subchannel is not active');
    });
  });

  describe('PaymentCancelTransition', () => {
    let subchannel: Awaited<ReturnType<typeof channel.openSubchannel>>;
    const amount = '500';
    const timelock = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago

    beforeEach(async () => {
      subchannel = await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      });

      // Create initial payment
      const createTransition = new PaymentCreateTransition(
        1,
        '0x1234',
        amount,
        ethers.keccak256(ethers.toUtf8Bytes('secret')),
        timelock,
        'encrypted_data',
      );

      await createTransition.apply(channel);
    });

    it('should cancel payment successfully after timelock', async () => {
      const transition = new PaymentCancelTransition(1, '0x1234', amount, timelock);

      await expect(transition.apply(channel)).to.not.be.rejected;
      const updatedSubchannel = channel.getSubchannel(subchannel.id);
      expect(updatedSubchannel?.balance).to.equal('0');
    });

    it('should fail if timelock not expired', async () => {
      const futureTimelock = Math.floor(Date.now() / 1000) + 3600;
      const transition = new PaymentCancelTransition(1, '0x1234', amount, futureTimelock);

      await expect(transition.apply(channel)).to.be.rejectedWith(TransitionError, 'Payment timelock not expired');
    });

    it('should verify valid cancellation', async () => {
      const transition = new PaymentCancelTransition(1, '0x1234', amount, timelock);
      expect(await transition.verify(channel)).to.be.true;
    });

    it('should not verify invalid cancellation', async () => {
      const futureTimelock = Math.floor(Date.now() / 1000) + 3600;
      const transition = new PaymentCancelTransition(1, '0x1234', amount, futureTimelock);
      expect(await transition.verify(channel)).to.be.false;
    });
  });

  describe('SwapCreateTransition', () => {
    let subchannelA: Awaited<ReturnType<typeof channel.openSubchannel>>;
    let subchannelB: Awaited<ReturnType<typeof channel.openSubchannel>>;

    beforeEach(async () => {
      subchannelA = await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      });

      subchannelB = await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x5678',
        capacity: '2000',
      });
    });

    it('should create swap successfully', async () => {
      const transition = new SwapCreateTransition(
        1,
        '0x1234',
        '0x5678',
        '500',
        '1000',
        userWallet.address,
        Math.floor(Date.now() / 1000) + 3600,
      );

      await expect(transition.apply(channel)).to.not.be.rejected;
      const updatedSubchannelA = channel.getSubchannel(subchannelA.id);
      const updatedSubchannelB = channel.getSubchannel(subchannelB.id);
      expect(updatedSubchannelA?.balance).to.equal('500');
      expect(updatedSubchannelB?.balance).to.equal('1000');
    });

    it('should fail if swap exceeds capacity', async () => {
      const transition = new SwapCreateTransition(
        1,
        '0x1234',
        '0x5678',
        '1500',
        '2500',
        userWallet.address,
        Math.floor(Date.now() / 1000) + 3600,
      );

      await expect(transition.apply(channel)).to.be.rejectedWith(TransitionError, 'Payment exceeds capacity');
    });

    it('should verify valid swap', async () => {
      const transition = new SwapCreateTransition(
        1,
        '0x1234',
        '0x5678',
        '500',
        '1000',
        userWallet.address,
        Math.floor(Date.now() / 1000) + 3600,
      );

      expect(await transition.verify(channel)).to.be.true;
    });

    it('should not verify invalid swap', async () => {
      const transition = new SwapCreateTransition(
        1,
        '0x1234',
        '0x5678',
        '1500',
        '2500',
        userWallet.address,
        Math.floor(Date.now() / 1000) + 3600,
      );

      expect(await transition.verify(channel)).to.be.false;
    });
  });

  describe('SwapSettleTransition', () => {
    let subchannelA: Awaited<ReturnType<typeof channel.openSubchannel>>;
    let subchannelB: Awaited<ReturnType<typeof channel.openSubchannel>>;
    const amountA = '500';
    const amountB = '1000';

    beforeEach(async () => {
      subchannelA = await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      });

      subchannelB = await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x5678',
        capacity: '2000',
      });

      // Create initial swap
      const createTransition = new SwapCreateTransition(
        1,
        '0x1234',
        '0x5678',
        amountA,
        amountB,
        userWallet.address,
        Math.floor(Date.now() / 1000) + 3600,
      );

      await createTransition.apply(channel);
    });

    it('should settle swap successfully', async () => {
      const transition = new SwapSettleTransition(1, '0x1234', '0x5678', amountA, amountB, userWallet.address);

      await expect(transition.apply(channel)).to.not.be.rejected;
      const updatedSubchannelA = channel.getSubchannel(subchannelA.id);
      const updatedSubchannelB = channel.getSubchannel(subchannelB.id);
      expect(updatedSubchannelA?.balance).to.equal('0');
      expect(updatedSubchannelB?.balance).to.equal('0');
    });

    it('should fail if swap not found', async () => {
      const transition = new SwapSettleTransition(1, '0x9999', '0xAAAA', amountA, amountB, userWallet.address);

      await expect(transition.apply(channel)).to.be.rejectedWith(TransitionError, 'Swap not found');
    });

    it('should verify valid settlement', async () => {
      const transition = new SwapSettleTransition(1, '0x1234', '0x5678', amountA, amountB, userWallet.address);

      expect(await transition.verify(channel)).to.be.true;
    });

    it('should not verify invalid settlement', async () => {
      const transition = new SwapSettleTransition(1, '0x1234', '0x5678', '1500', '2500', userWallet.address);

      expect(await transition.verify(channel)).to.be.false;
    });
  });

  describe('SubchannelUpdateTransition', () => {
    let subchannel: Awaited<ReturnType<typeof channel.openSubchannel>>;

    beforeEach(async () => {
      subchannel = await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      });
    });

    it('should update balance successfully', async () => {
      const transition = new SubchannelUpdateTransition(1, '0x1234', '500');

      await expect(transition.apply(channel)).to.not.be.rejected;
      const updatedSubchannel = channel.getSubchannel(subchannel.id);
      expect(updatedSubchannel?.balance).to.equal('500');
    });

    it('should fail if balance exceeds capacity', async () => {
      const transition = new SubchannelUpdateTransition(1, '0x1234', '1500');

      await expect(transition.apply(channel)).to.be.rejectedWith(TransitionError, 'Balance exceeds capacity');
    });

    it('should verify valid update', async () => {
      const transition = new SubchannelUpdateTransition(1, '0x1234', '500');
      expect(await transition.verify(channel)).to.be.true;
    });

    it('should not verify invalid update', async () => {
      const transition = new SubchannelUpdateTransition(1, '0x1234', '1500');
      expect(await transition.verify(channel)).to.be.false;
    });
  });

  describe('SubchannelCloseTransition', () => {
    let subchannel: Awaited<ReturnType<typeof channel.openSubchannel>>;

    beforeEach(async () => {
      subchannel = await channel.openSubchannel({
        chainId: 1,
        tokenId: '0x1234',
        capacity: '1000',
      });

      // Add some balance
      const updateTransition = new SubchannelUpdateTransition(1, '0x1234', '500');
      await updateTransition.apply(channel);
    });

    it('should close subchannel successfully', async () => {
      const transition = new SubchannelCloseTransition(1, '0x1234', '500');

      await expect(transition.apply(channel)).to.not.be.rejected;
      const updatedSubchannel = channel.getSubchannel(subchannel.id);
      expect(updatedSubchannel?.status).to.equal('closed');
      expect(updatedSubchannel?.balance).to.equal('500');
    });

    it('should update final balance before closing', async () => {
      const transition = new SubchannelCloseTransition(1, '0x1234', '300');

      await expect(transition.apply(channel)).to.not.be.rejected;
      const updatedSubchannel = channel.getSubchannel(subchannel.id);
      expect(updatedSubchannel?.status).to.equal('closed');
      expect(updatedSubchannel?.balance).to.equal('300');
    });

    it('should fail if subchannel not found', async () => {
      const transition = new SubchannelCloseTransition(2, '0x5678', '500');

      await expect(transition.apply(channel)).to.be.rejectedWith(TransitionError, 'Subchannel not found');
    });

    it('should verify valid close', async () => {
      const transition = new SubchannelCloseTransition(1, '0x1234', '500');
      expect(await transition.verify(channel)).to.be.true;
    });

    it('should not verify invalid close', async () => {
      const transition = new SubchannelCloseTransition(1, '0x1234', '1500');
      expect(await transition.verify(channel)).to.be.false;
    });

    it('should not verify already closed subchannel', async () => {
      await channel.closeSubchannel(subchannel.id);
      const transition = new SubchannelCloseTransition(1, '0x1234', '500');
      expect(await transition.verify(channel)).to.be.false;
    });
  });
});
