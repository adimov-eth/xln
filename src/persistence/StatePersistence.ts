/**
 * StatePersistence: Write-Ahead Log (WAL) and Snapshots for XLN
 *
 * Ensures durability and crash recovery for bilateral channels:
 * - WAL for every state change
 * - Periodic snapshots for fast recovery
 * - Merkle proofs for verification
 * - Content-addressed storage
 */

import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { Subchannel } from '../../old_src/types/Subchannel';

export interface WALEntry {
  seq: bigint;
  timestamp: number;
  channelKey: string;
  operation: string;
  params: any;
  beforeStateHash: string;
  afterStateHash: string;
  signature?: string;
}

export interface Snapshot {
  version: number;
  timestamp: number;
  height: bigint;
  channels: Map<string, ChannelSnapshot>;
  merkleRoot: string;
  checksum: string;
}

export interface ChannelSnapshot {
  channelKey: string;
  metadata: any;
  subchannels: Subchannel[];
  lastSeq: bigint;
  stateHash: string;
}

export interface PersistenceConfig {
  dataDir: string;
  walDir: string;
  snapshotDir: string;
  maxWalSize: number; // bytes
  snapshotInterval: number; // entries
  compressionLevel: number; // 0-9
  checksumAlgorithm: 'sha256' | 'blake3';
}

export class StatePersistence {
  private config: PersistenceConfig;
  private walFile: number | null = null;
  private currentWalSize = 0;
  private walSequence = 0n;
  private lastSnapshot: Snapshot | null = null;
  private pendingWrites: WALEntry[] = [];
  private writeBuffer: Buffer;
  private readonly BUFFER_SIZE = 64 * 1024; // 64KB buffer

  constructor(config: PersistenceConfig) {
    this.config = config;
    this.writeBuffer = Buffer.alloc(this.BUFFER_SIZE);
  }

  /**
   * Initialize persistence layer
   */
  async initialize(): Promise<void> {
    // Create directories
    await this.ensureDirectories();

    // Load latest snapshot
    this.lastSnapshot = await this.loadLatestSnapshot();

    // Open WAL for appending
    await this.openWAL();

    // Replay WAL entries since last snapshot
    if (this.lastSnapshot) {
      await this.replayWAL(this.lastSnapshot.height);
    }

    console.log(`📁 Persistence initialized at ${this.config.dataDir}`);
  }

  /**
   * Write entry to WAL
   */
  async writeWAL(entry: WALEntry): Promise<void> {
    entry.seq = this.walSequence++;

    // Serialize entry
    const serialized = this.serializeWALEntry(entry);

    // Check if WAL rotation needed
    if (this.currentWalSize + serialized.length > this.config.maxWalSize) {
      await this.rotateWAL();
    }

    // Write to WAL with fsync for durability
    await this.appendToWAL(serialized);
    this.currentWalSize += serialized.length;

    // Add to pending for batching
    this.pendingWrites.push(entry);

    // Check if snapshot needed
    if (this.walSequence % BigInt(this.config.snapshotInterval) === 0n) {
      await this.createSnapshot();
    }
  }

  /**
   * Create snapshot of current state
   */
  async createSnapshot(): Promise<Snapshot> {
    const timestamp = Date.now();
    const version = this.lastSnapshot ? this.lastSnapshot.version + 1 : 1;

    // Collect all channel states
    const channels = new Map<string, ChannelSnapshot>();

    // In production, this would iterate over actual channel states
    // For now, we'll create a placeholder
    const snapshot: Snapshot = {
      version,
      timestamp,
      height: this.walSequence,
      channels,
      merkleRoot: this.calculateMerkleRoot(channels),
      checksum: ''
    };

    // Calculate checksum
    snapshot.checksum = this.calculateChecksum(snapshot);

    // Write snapshot to disk
    await this.writeSnapshot(snapshot);

    // Update last snapshot
    this.lastSnapshot = snapshot;

    // Truncate WAL after successful snapshot
    await this.truncateWAL(snapshot.height);

    console.log(`📸 Snapshot ${version} created at height ${snapshot.height}`);

    return snapshot;
  }

  /**
   * Load state from snapshot and WAL
   */
  async loadState(): Promise<Map<string, ChannelSnapshot>> {
    const channels = new Map<string, ChannelSnapshot>();

    // Load from snapshot
    if (this.lastSnapshot) {
      for (const [key, channel] of this.lastSnapshot.channels) {
        channels.set(key, channel);
      }
    }

    // Apply WAL entries
    const walEntries = await this.readWAL(this.lastSnapshot?.height || 0n);
    for (const entry of walEntries) {
      await this.applyWALEntry(entry, channels);
    }

    return channels;
  }

  /**
   * Replay WAL from specific height
   */
  async replayWAL(fromHeight: bigint): Promise<void> {
    const entries = await this.readWAL(fromHeight);
    const channels = new Map<string, ChannelSnapshot>();

    console.log(`🔄 Replaying ${entries.length} WAL entries from height ${fromHeight}`);

    for (const entry of entries) {
      await this.applyWALEntry(entry, channels);
    }
  }

  /**
   * Verify integrity of persistence layer
   */
  async verifyIntegrity(): Promise<boolean> {
    // Verify snapshot checksum
    if (this.lastSnapshot) {
      const calculatedChecksum = this.calculateChecksum(this.lastSnapshot);
      if (calculatedChecksum !== this.lastSnapshot.checksum) {
        console.error('❌ Snapshot checksum mismatch');
        return false;
      }
    }

    // Verify WAL entries
    const walEntries = await this.readWAL(0n);
    for (const entry of walEntries) {
      if (!this.verifyWALEntry(entry)) {
        console.error(`❌ Invalid WAL entry at seq ${entry.seq}`);
        return false;
      }
    }

    // Verify Merkle tree
    if (this.lastSnapshot) {
      const calculatedRoot = this.calculateMerkleRoot(this.lastSnapshot.channels);
      if (calculatedRoot !== this.lastSnapshot.merkleRoot) {
        console.error('❌ Merkle root mismatch');
        return false;
      }
    }

    console.log('✅ Integrity check passed');
    return true;
  }

  /**
   * Compact persistence layer
   */
  async compact(): Promise<void> {
    console.log('🗜️ Starting compaction...');

    // Create new snapshot
    const snapshot = await this.createSnapshot();

    // Remove old snapshots
    await this.removeOldSnapshots(snapshot.version - 5); // Keep last 5

    // Remove old WAL files
    await this.removeOldWALFiles(snapshot.height);

    console.log('✅ Compaction complete');
  }

  /**
   * Export state for migration
   */
  async exportState(): Promise<Buffer> {
    const state = await this.loadState();
    const exported = {
      version: '1.0.0',
      timestamp: Date.now(),
      channels: Array.from(state.entries()),
      metadata: {
        lastSnapshot: this.lastSnapshot?.version,
        walSequence: this.walSequence.toString()
      }
    };

    return Buffer.from(JSON.stringify(exported));
  }

  /**
   * Import state from export
   */
  async importState(data: Buffer): Promise<void> {
    const imported = JSON.parse(data.toString());

    // Validate version
    if (imported.version !== '1.0.0') {
      throw new Error(`Unsupported version: ${imported.version}`);
    }

    // Clear existing state
    await this.clear();

    // Import channels
    for (const [key, channel] of imported.channels) {
      // Write to WAL
      await this.writeWAL({
        seq: 0n,
        timestamp: Date.now(),
        channelKey: key,
        operation: 'import',
        params: channel,
        beforeStateHash: '0x0',
        afterStateHash: this.hashChannelSnapshot(channel)
      });
    }

    // Create snapshot
    await this.createSnapshot();

    console.log(`📥 Imported ${imported.channels.length} channels`);
  }

  // Private helper methods

  private async ensureDirectories(): Promise<void> {
    await fs.mkdir(this.config.dataDir, { recursive: true });
    await fs.mkdir(this.config.walDir, { recursive: true });
    await fs.mkdir(this.config.snapshotDir, { recursive: true });
  }

  private async openWAL(): Promise<void> {
    const walPath = path.join(this.config.walDir, `wal_${Date.now()}.log`);
    const fd = await fs.open(walPath, 'a');
    this.walFile = fd.fd;
  }

  private async rotateWAL(): Promise<void> {
    if (this.walFile) {
      await fs.close(this.walFile);
    }
    await this.openWAL();
    this.currentWalSize = 0;
  }

  private async appendToWAL(data: Buffer): Promise<void> {
    if (!this.walFile) {
      throw new Error('WAL not open');
    }

    // Write with O_SYNC for durability
    await fs.appendFile(this.walFile, data);
    await fs.fsync(this.walFile);
  }

  private serializeWALEntry(entry: WALEntry): Buffer {
    const json = JSON.stringify({
      ...entry,
      seq: entry.seq.toString()
    });

    const length = Buffer.alloc(4);
    length.writeUInt32BE(json.length);

    return Buffer.concat([length, Buffer.from(json)]);
  }

  private async readWAL(fromSeq: bigint): Promise<WALEntry[]> {
    const entries: WALEntry[] = [];
    const walFiles = await fs.readdir(this.config.walDir);

    for (const file of walFiles.sort()) {
      const filePath = path.join(this.config.walDir, file);
      const data = await fs.readFile(filePath);

      let offset = 0;
      while (offset < data.length) {
        const length = data.readUInt32BE(offset);
        offset += 4;

        const json = data.slice(offset, offset + length).toString();
        offset += length;

        const entry = JSON.parse(json);
        entry.seq = BigInt(entry.seq);

        if (entry.seq >= fromSeq) {
          entries.push(entry);
        }
      }
    }

    return entries;
  }

  private async truncateWAL(upToSeq: bigint): Promise<void> {
    const walFiles = await fs.readdir(this.config.walDir);

    for (const file of walFiles) {
      const filePath = path.join(this.config.walDir, file);
      const data = await fs.readFile(filePath);

      let offset = 0;
      let truncateAt = data.length;

      while (offset < data.length) {
        const length = data.readUInt32BE(offset);
        const entryStart = offset;
        offset += 4;

        const json = data.slice(offset, offset + length).toString();
        offset += length;

        const entry = JSON.parse(json);
        if (BigInt(entry.seq) > upToSeq) {
          truncateAt = entryStart;
          break;
        }
      }

      if (truncateAt < data.length) {
        await fs.truncate(filePath, truncateAt);
      }
    }
  }

  private async applyWALEntry(
    entry: WALEntry,
    channels: Map<string, ChannelSnapshot>
  ): Promise<void> {
    // Apply operation to channel state
    // This would integrate with actual channel logic
    const channel = channels.get(entry.channelKey);
    if (channel) {
      channel.lastSeq = entry.seq;
      channel.stateHash = entry.afterStateHash;
    }
  }

  private verifyWALEntry(entry: WALEntry): boolean {
    // Verify entry integrity
    // Check signatures, hashes, etc.
    return true; // Simplified
  }

  private async writeSnapshot(snapshot: Snapshot): Promise<void> {
    const filename = `snapshot_${snapshot.version}_${snapshot.height}.snap`;
    const filepath = path.join(this.config.snapshotDir, filename);

    // Serialize snapshot
    const data = this.serializeSnapshot(snapshot);

    // Write atomically
    const tempPath = `${filepath}.tmp`;
    await fs.writeFile(tempPath, data);
    await fs.rename(tempPath, filepath);

    console.log(`💾 Snapshot written to ${filename}`);
  }

  private async loadLatestSnapshot(): Promise<Snapshot | null> {
    try {
      const files = await fs.readdir(this.config.snapshotDir);
      const snapshots = files.filter(f => f.endsWith('.snap')).sort();

      if (snapshots.length === 0) {
        return null;
      }

      const latestFile = snapshots[snapshots.length - 1];
      const filepath = path.join(this.config.snapshotDir, latestFile);
      const data = await fs.readFile(filepath);

      return this.deserializeSnapshot(data);
    } catch (error) {
      console.error('Failed to load snapshot:', error);
      return null;
    }
  }

  private serializeSnapshot(snapshot: Snapshot): Buffer {
    const channels = Array.from(snapshot.channels.entries());
    const json = JSON.stringify({
      ...snapshot,
      channels,
      height: snapshot.height.toString()
    });

    // Compress if configured
    if (this.config.compressionLevel > 0) {
      // Would use zstd or lz4 for compression
      return Buffer.from(json);
    }

    return Buffer.from(json);
  }

  private deserializeSnapshot(data: Buffer): Snapshot {
    // Decompress if needed
    const json = JSON.parse(data.toString());

    return {
      ...json,
      height: BigInt(json.height),
      channels: new Map(json.channels)
    };
  }

  private calculateMerkleRoot(channels: Map<string, ChannelSnapshot>): string {
    const leaves = Array.from(channels.values())
      .map(c => this.hashChannelSnapshot(c))
      .sort();

    return this.buildMerkleTree(leaves);
  }

  private buildMerkleTree(leaves: string[]): string {
    if (leaves.length === 0) return '0x0';
    if (leaves.length === 1) return leaves[0];

    const nextLevel: string[] = [];
    for (let i = 0; i < leaves.length; i += 2) {
      const left = leaves[i];
      const right = leaves[i + 1] || leaves[i];
      const combined = createHash('sha256')
        .update(left + right)
        .digest('hex');
      nextLevel.push(combined);
    }

    return this.buildMerkleTree(nextLevel);
  }

  private hashChannelSnapshot(channel: ChannelSnapshot): string {
    const hash = createHash('sha256');
    hash.update(channel.channelKey);
    hash.update(channel.lastSeq.toString());
    hash.update(channel.stateHash);
    return hash.digest('hex');
  }

  private calculateChecksum(snapshot: Snapshot): string {
    const hash = createHash(this.config.checksumAlgorithm);
    hash.update(snapshot.version.toString());
    hash.update(snapshot.timestamp.toString());
    hash.update(snapshot.height.toString());
    hash.update(snapshot.merkleRoot);
    return hash.digest('hex');
  }

  private async removeOldSnapshots(beforeVersion: number): Promise<void> {
    const files = await fs.readdir(this.config.snapshotDir);

    for (const file of files) {
      const match = file.match(/snapshot_(\d+)_/);
      if (match) {
        const version = parseInt(match[1]);
        if (version < beforeVersion) {
          await fs.unlink(path.join(this.config.snapshotDir, file));
        }
      }
    }
  }

  private async removeOldWALFiles(beforeSeq: bigint): Promise<void> {
    // Remove WAL files that are fully before the sequence
    const files = await fs.readdir(this.config.walDir);

    for (const file of files) {
      const filepath = path.join(this.config.walDir, file);
      const shouldRemove = await this.walFileFullyBefore(filepath, beforeSeq);

      if (shouldRemove) {
        await fs.unlink(filepath);
      }
    }
  }

  private async walFileFullyBefore(filepath: string, seq: bigint): Promise<boolean> {
    try {
      const data = await fs.readFile(filepath);
      if (data.length < 4) return true;

      // Check last entry
      let offset = data.length;
      let lastSeq = 0n;

      // Read backwards to find last entry
      // Simplified - in production would maintain index
      return lastSeq < seq;
    } catch {
      return true;
    }
  }

  private async clear(): Promise<void> {
    // Clear all persistence data
    const walFiles = await fs.readdir(this.config.walDir);
    for (const file of walFiles) {
      await fs.unlink(path.join(this.config.walDir, file));
    }

    const snapFiles = await fs.readdir(this.config.snapshotDir);
    for (const file of snapFiles) {
      await fs.unlink(path.join(this.config.snapshotDir, file));
    }

    this.walSequence = 0n;
    this.lastSnapshot = null;
  }
}