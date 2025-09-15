/**
 * XLN Real-time Monitoring Dashboard
 *
 * Shows bilateral sovereignty in action:
 * - Channel metrics without global state
 * - Parallel TPS across channels
 * - Network topology visualization
 * - Byzantine fault detection
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Line, Bar, Doughnut, Scatter } from 'react-chartjs-2';
import { WebSocket } from 'ws';

interface DashboardProps {
  wsEndpoint: string;
  refreshInterval: number;
}

interface NetworkMetrics {
  totalChannels: number;
  activeChannels: number;
  totalTransactions: bigint;
  totalVolume: bigint;
  tps: number;
  averageLatency: number;
  byzantineFaults: number;
  slashingEvents: number;
}

interface ChannelMetrics {
  channelKey: string;
  leftEntity: string;
  rightEntity: string;
  status: string;
  offdelta: bigint;
  ondelta: bigint;
  transactions: number;
  volume: bigint;
  lastActivity: number;
}

interface ValidatorMetrics {
  nodeId: string;
  isPrimary: boolean;
  blockHeight: bigint;
  viewNumber: number;
  phase: string;
  mempoolSize: number;
  connectedPeers: number;
}

const Dashboard: React.FC<DashboardProps> = ({ wsEndpoint, refreshInterval }) => {
  const [networkMetrics, setNetworkMetrics] = useState<NetworkMetrics>({
    totalChannels: 0,
    activeChannels: 0,
    totalTransactions: 0n,
    totalVolume: 0n,
    tps: 0,
    averageLatency: 0,
    byzantineFaults: 0,
    slashingEvents: 0
  });

  const [channels, setChannels] = useState<ChannelMetrics[]>([]);
  const [validators, setValidators] = useState<ValidatorMetrics[]>([]);
  const [tpsHistory, setTpsHistory] = useState<number[]>([]);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);

  // WebSocket connection
  useEffect(() => {
    const ws = new WebSocket(wsEndpoint);

    ws.on('message', (data: string) => {
      const message = JSON.parse(data);

      switch (message.type) {
        case 'network_metrics':
          setNetworkMetrics(message.data);
          setTpsHistory(prev => [...prev.slice(-59), message.data.tps]);
          setLatencyHistory(prev => [...prev.slice(-59), message.data.averageLatency]);
          break;

        case 'channel_update':
          updateChannel(message.data);
          break;

        case 'validator_update':
          updateValidator(message.data);
          break;

        case 'alert':
          handleAlert(message.data);
          break;
      }
    });

    return () => ws.close();
  }, [wsEndpoint]);

  // Periodic refresh
  useEffect(() => {
    const interval = setInterval(() => {
      fetchMetrics();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [refreshInterval]);

  const fetchMetrics = async () => {
    try {
      const response = await fetch('/api/metrics');
      const data = await response.json();
      setNetworkMetrics(data.network);
      setChannels(data.channels);
      setValidators(data.validators);
    } catch (error) {
      console.error('Failed to fetch metrics:', error);
    }
  };

  const updateChannel = (channel: ChannelMetrics) => {
    setChannels(prev => {
      const index = prev.findIndex(c => c.channelKey === channel.channelKey);
      if (index >= 0) {
        prev[index] = channel;
        return [...prev];
      }
      return [...prev, channel];
    });
  };

  const updateValidator = (validator: ValidatorMetrics) => {
    setValidators(prev => {
      const index = prev.findIndex(v => v.nodeId === validator.nodeId);
      if (index >= 0) {
        prev[index] = validator;
        return [...prev];
      }
      return [...prev, validator];
    });
  };

  const handleAlert = (alert: any) => {
    // Show alert notification
    console.warn('Alert:', alert);
  };

  // Format large numbers
  const formatNumber = (n: bigint | number): string => {
    if (typeof n === 'bigint') {
      n = Number(n);
    }
    if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
    return n.toString();
  };

  // TPS Chart
  const tpsChartData = {
    labels: tpsHistory.map((_, i) => `${60 - i}s`),
    datasets: [{
      label: 'TPS',
      data: tpsHistory,
      borderColor: 'rgb(75, 192, 192)',
      backgroundColor: 'rgba(75, 192, 192, 0.2)',
      tension: 0.4
    }]
  };

  // Latency Chart
  const latencyChartData = {
    labels: latencyHistory.map((_, i) => `${60 - i}s`),
    datasets: [{
      label: 'Latency (ms)',
      data: latencyHistory,
      borderColor: 'rgb(255, 99, 132)',
      backgroundColor: 'rgba(255, 99, 132, 0.2)',
      tension: 0.4
    }]
  };

  // Channel Distribution
  const channelDistribution = {
    labels: ['Active', 'Disputed', 'Closing', 'Closed'],
    datasets: [{
      data: [
        channels.filter(c => c.status === 'active').length,
        channels.filter(c => c.status === 'disputed').length,
        channels.filter(c => c.status === 'closing').length,
        channels.filter(c => c.status === 'closed').length
      ],
      backgroundColor: [
        'rgba(75, 192, 192, 0.8)',
        'rgba(255, 206, 86, 0.8)',
        'rgba(255, 159, 64, 0.8)',
        'rgba(201, 203, 207, 0.8)'
      ]
    }]
  };

  // Network Topology (simplified)
  const topologyData = {
    datasets: [{
      label: 'Channels',
      data: channels.map(c => ({
        x: Math.random() * 100,
        y: Math.random() * 100,
        r: Math.log10(Number(c.volume) + 1) * 3
      })),
      backgroundColor: 'rgba(54, 162, 235, 0.5)'
    }]
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>XLN Network Monitor</h1>
        <div className="network-stats">
          <div className="stat">
            <span className="label">Channels</span>
            <span className="value">{networkMetrics.activeChannels}/{networkMetrics.totalChannels}</span>
          </div>
          <div className="stat">
            <span className="label">TPS</span>
            <span className="value">{formatNumber(networkMetrics.tps)}</span>
          </div>
          <div className="stat">
            <span className="label">Volume</span>
            <span className="value">${formatNumber(networkMetrics.totalVolume)}</span>
          </div>
          <div className="stat">
            <span className="label">Latency</span>
            <span className="value">{networkMetrics.averageLatency.toFixed(1)}ms</span>
          </div>
        </div>
      </header>

      <div className="dashboard-grid">
        {/* Real-time TPS */}
        <div className="panel">
          <h2>Transactions Per Second</h2>
          <Line data={tpsChartData} options={{
            responsive: true,
            scales: {
              y: { beginAtZero: true }
            }
          }} />
          <div className="panel-footer">
            Peak: {Math.max(...tpsHistory)} TPS
          </div>
        </div>

        {/* Latency */}
        <div className="panel">
          <h2>Network Latency</h2>
          <Line data={latencyChartData} options={{
            responsive: true,
            scales: {
              y: { beginAtZero: true }
            }
          }} />
          <div className="panel-footer">
            P95: {(latencyHistory.sort()[Math.floor(latencyHistory.length * 0.95)] || 0).toFixed(1)}ms
          </div>
        </div>

        {/* Channel Status */}
        <div className="panel">
          <h2>Channel Distribution</h2>
          <Doughnut data={channelDistribution} />
          <div className="panel-footer">
            Byzantine Faults: {networkMetrics.byzantineFaults}
          </div>
        </div>

        {/* Network Topology */}
        <div className="panel">
          <h2>Network Topology</h2>
          <Scatter data={topologyData} options={{
            responsive: true,
            scales: {
              x: { display: false },
              y: { display: false }
            }
          }} />
          <div className="panel-footer">
            Slashing Events: {networkMetrics.slashingEvents}
          </div>
        </div>

        {/* Active Channels Table */}
        <div className="panel panel-wide">
          <h2>Active Channels</h2>
          <table className="channels-table">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Entities</th>
                <th>Status</th>
                <th>Offdelta</th>
                <th>Ondelta</th>
                <th>TXs</th>
                <th>Volume</th>
                <th>Activity</th>
              </tr>
            </thead>
            <tbody>
              {channels
                .filter(c => c.status === 'active')
                .sort((a, b) => b.lastActivity - a.lastActivity)
                .slice(0, 10)
                .map(channel => (
                  <tr
                    key={channel.channelKey}
                    onClick={() => setSelectedChannel(channel.channelKey)}
                    className={selectedChannel === channel.channelKey ? 'selected' : ''}
                  >
                    <td>{channel.channelKey}</td>
                    <td>{channel.leftEntity} ↔ {channel.rightEntity}</td>
                    <td>
                      <span className={`status status-${channel.status}`}>
                        {channel.status}
                      </span>
                    </td>
                    <td>{formatNumber(channel.offdelta)}</td>
                    <td>{formatNumber(channel.ondelta)}</td>
                    <td>{formatNumber(channel.transactions)}</td>
                    <td>${formatNumber(channel.volume)}</td>
                    <td>{new Date(channel.lastActivity).toLocaleTimeString()}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        {/* Validator Status */}
        <div className="panel panel-wide">
          <h2>Validator Nodes</h2>
          <table className="validators-table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Role</th>
                <th>Height</th>
                <th>View</th>
                <th>Phase</th>
                <th>Mempool</th>
                <th>Peers</th>
              </tr>
            </thead>
            <tbody>
              {validators.map(validator => (
                <tr key={validator.nodeId}>
                  <td>{validator.nodeId}</td>
                  <td>
                    {validator.isPrimary ? (
                      <span className="primary">PRIMARY</span>
                    ) : (
                      <span className="backup">BACKUP</span>
                    )}
                  </td>
                  <td>{validator.blockHeight.toString()}</td>
                  <td>{validator.viewNumber}</td>
                  <td>
                    <span className={`phase phase-${validator.phase}`}>
                      {validator.phase}
                    </span>
                  </td>
                  <td>{validator.mempoolSize}</td>
                  <td>{validator.connectedPeers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Alerts */}
      <div className="alerts-panel">
        <h3>System Alerts</h3>
        <div className="alerts-list">
          {networkMetrics.byzantineFaults > 0 && (
            <div className="alert alert-warning">
              ⚠️ {networkMetrics.byzantineFaults} Byzantine faults detected
            </div>
          )}
          {networkMetrics.averageLatency > 100 && (
            <div className="alert alert-warning">
              ⚠️ High latency detected: {networkMetrics.averageLatency.toFixed(1)}ms
            </div>
          )}
          {networkMetrics.slashingEvents > 0 && (
            <div className="alert alert-error">
              🔴 {networkMetrics.slashingEvents} slashing events occurred
            </div>
          )}
        </div>
      </div>

      <style jsx>{`
        .dashboard {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #0a0a0a;
          color: #e0e0e0;
          min-height: 100vh;
          padding: 20px;
        }

        .dashboard-header {
          margin-bottom: 30px;
          border-bottom: 1px solid #333;
          padding-bottom: 20px;
        }

        .dashboard-header h1 {
          font-size: 32px;
          margin: 0 0 20px 0;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }

        .network-stats {
          display: flex;
          gap: 40px;
        }

        .stat {
          display: flex;
          flex-direction: column;
        }

        .stat .label {
          font-size: 12px;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .stat .value {
          font-size: 24px;
          font-weight: bold;
          color: #fff;
        }

        .dashboard-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
          gap: 20px;
        }

        .panel {
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 8px;
          padding: 20px;
        }

        .panel-wide {
          grid-column: span 2;
        }

        .panel h2 {
          font-size: 18px;
          margin: 0 0 20px 0;
          color: #fff;
        }

        .panel-footer {
          margin-top: 15px;
          padding-top: 15px;
          border-top: 1px solid #333;
          font-size: 14px;
          color: #888;
        }

        .channels-table,
        .validators-table {
          width: 100%;
          border-collapse: collapse;
        }

        .channels-table th,
        .validators-table th {
          text-align: left;
          padding: 10px;
          border-bottom: 2px solid #333;
          font-size: 12px;
          text-transform: uppercase;
          color: #888;
        }

        .channels-table td,
        .validators-table td {
          padding: 10px;
          border-bottom: 1px solid #222;
          font-size: 14px;
        }

        .channels-table tr:hover,
        .validators-table tr:hover {
          background: #222;
          cursor: pointer;
        }

        .channels-table tr.selected {
          background: #2a2a3a;
        }

        .status {
          padding: 2px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: bold;
          text-transform: uppercase;
        }

        .status-active {
          background: #10b981;
          color: #fff;
        }

        .status-disputed {
          background: #f59e0b;
          color: #fff;
        }

        .status-closing {
          background: #ef4444;
          color: #fff;
        }

        .status-closed {
          background: #6b7280;
          color: #fff;
        }

        .primary {
          color: #10b981;
          font-weight: bold;
        }

        .backup {
          color: #6b7280;
        }

        .phase {
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
        }

        .phase-idle {
          background: #374151;
        }

        .phase-propose {
          background: #3b82f6;
        }

        .phase-prepare {
          background: #f59e0b;
        }

        .phase-commit {
          background: #10b981;
        }

        .phase-view_change {
          background: #ef4444;
        }

        .alerts-panel {
          margin-top: 30px;
          padding: 20px;
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 8px;
        }

        .alerts-panel h3 {
          margin: 0 0 15px 0;
          font-size: 16px;
          color: #fff;
        }

        .alerts-list {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }

        .alert {
          padding: 10px 15px;
          border-radius: 4px;
          font-size: 14px;
        }

        .alert-warning {
          background: #fbbf24;
          color: #000;
        }

        .alert-error {
          background: #ef4444;
          color: #fff;
        }
      `}</style>
    </div>
  );
};

export default Dashboard;