'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ReactFlow, {
  type Node,
  type Edge,
  type Connection,
  addEdge,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type NodeProps,
  MarkerType,
  BackgroundVariant,
} from 'reactflow';
import 'reactflow/dist/style.css';
import Link from 'next/link';

interface AudioFileOption { _id: string; name: string; asteriskPath: string; category: string; }

// ---- Node Components ------------------------------------------------------

function StartNode() {
  return (
    <div style={{
      background: 'linear-gradient(135deg,hsl(145,70%,35%),hsl(145,70%,25%))',
      border: '2px solid hsl(145,70%,45%)', borderRadius: '50%',
      width: 80, height: 80, display: 'flex', alignItems: 'center',
      justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '0.75rem',
    }}>
      START
      <Handle type="source" position={Position.Bottom} style={{ background: 'hsl(145,70%,45%)' }} />
    </div>
  );
}

function PlayNode({ data, selected }: NodeProps) {
  return (
    <div style={{
      background: selected ? 'hsl(220,18%,20%)' : 'hsl(220,18%,16%)',
      border: `2px solid ${selected ? 'hsl(220,75%,55%)' : 'hsl(220,14%,28%)'}`,
      borderRadius: 12, padding: '12px 16px', minWidth: 180,
    }}>
      <Handle type="target" position={Position.Top} style={{ background: 'hsl(220,75%,50%)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span>▶</span>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(220,75%,65%)', textTransform: 'uppercase' }}>Play Audio</span>
      </div>
      <div style={{ fontSize: '0.8rem', color: 'hsl(220,15%,80%)' }}>
        {data.audioFile ? `🔊 ${String(data.audioFile)}` : <span style={{ color: 'hsl(220,8%,50%)' }}>No audio set</span>}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: 'hsl(220,75%,50%)' }} />
    </div>
  );
}

function DtmfNode({ data, selected }: NodeProps) {
  return (
    <div style={{
      background: selected ? 'hsl(265,18%,20%)' : 'hsl(265,18%,16%)',
      border: `2px solid ${selected ? 'hsl(265,85%,60%)' : 'hsl(265,14%,30%)'}`,
      borderRadius: 12, padding: '12px 16px', minWidth: 200,
    }}>
      <Handle type="target" position={Position.Top} style={{ background: 'hsl(265,85%,55%)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span>🔢</span>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(265,80%,70%)', textTransform: 'uppercase' }}>Collect DTMF</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 6 }}>
        <div style={{ fontSize: '0.72rem', color: 'hsl(220,8%,55%)' }}>Timeout: <span style={{ color: 'hsl(220,15%,80%)' }}>{String(data.timeoutSeconds ?? 5)}s</span></div>
        <div style={{ fontSize: '0.72rem', color: 'hsl(220,8%,55%)' }}>Digits: <span style={{ color: 'hsl(220,15%,80%)' }}>{String(data.maxDigits ?? 1)}</span></div>
      </div>
      {Array.isArray(data.branches) && data.branches.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {(data.branches as Array<{ digit: string }>).map((b) => (
            <span key={b.digit} style={{
              background: 'hsl(265,30%,25%)', border: '1px solid hsl(265,40%,35%)',
              borderRadius: 4, padding: '1px 6px', fontSize: '0.7rem', color: 'hsl(265,80%,70%)',
            }}>{b.digit}</span>
          ))}
        </div>
      )}
      <Handle type="source" position={Position.Bottom} style={{ background: 'hsl(265,85%,55%)' }} />
    </div>
  );
}

function RouteAgentNode({ data, selected }: NodeProps) {
  return (
    <div style={{
      background: selected ? 'hsl(145,18%,18%)' : 'hsl(145,18%,14%)',
      border: `2px solid ${selected ? 'hsl(145,70%,45%)' : 'hsl(145,14%,25%)'}`,
      borderRadius: 12, padding: '12px 16px', minWidth: 180,
    }}>
      <Handle type="target" position={Position.Top} style={{ background: 'hsl(145,70%,45%)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span>👤</span>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(145,60%,55%)', textTransform: 'uppercase' }}>Route to Agent</span>
      </div>
      <div style={{ fontSize: '0.8rem', color: 'hsl(220,15%,80%)' }}>
        Strategy: <span style={{ color: 'hsl(145,60%,55%)' }}>{String(data.agentSelectionStrategy ?? 'round_robin')}</span>
      </div>
    </div>
  );
}

function TransferNode({ data, selected }: NodeProps) {
  return (
    <div style={{
      background: selected ? 'hsl(190,25%,20%)' : 'hsl(190,25%,15%)',
      border: `2px solid ${selected ? 'hsl(190,80%,50%)' : 'hsl(190,20%,30%)'}`,
      borderRadius: 12, padding: '12px 16px', minWidth: 200,
    }}>
      <Handle type="target" position={Position.Top} style={{ background: 'hsl(190,80%,50%)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span>📞</span>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(190,75%,65%)', textTransform: 'uppercase' }}>Forward Call</span>
      </div>
      <div style={{ fontSize: '0.8rem', color: 'hsl(220,15%,80%)' }}>
        {data.transferTo
          ? <span>→ <strong style={{ color: 'hsl(190,75%,65%)' }}>{String(data.transferTo)}</strong></span>
          : <span style={{ color: 'hsl(220,8%,50%)' }}>No destination set</span>}
      </div>
      {data.transferTrunk && (
        <div style={{ fontSize: '0.72rem', color: 'hsl(220,8%,50%)', marginTop: 4 }}>
          Trunk: {String(data.transferTrunk)}
        </div>
      )}
    </div>
  );
}

function WebhookNode({ data, selected }: NodeProps) {
  return (
    <div style={{
      background: selected ? 'hsl(38,18%,18%)' : 'hsl(38,18%,14%)',
      border: `2px solid ${selected ? 'hsl(38,90%,55%)' : 'hsl(38,14%,28%)'}`,
      borderRadius: 12, padding: '12px 16px', minWidth: 180,
    }}>
      <Handle type="target" position={Position.Top} style={{ background: 'hsl(38,90%,55%)' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span>🔗</span>
        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'hsl(38,80%,65%)', textTransform: 'uppercase' }}>Webhook</span>
      </div>
      <div style={{ fontSize: '0.75rem', color: 'hsl(220,8%,55%)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {data.webhookUrl ? `→ ${String(data.webhookUrl)}` : <span style={{ color: 'hsl(220,8%,45%)' }}>No URL set</span>}
      </div>
      <Handle type="source" id="success" position={Position.Bottom} style={{ left: '30%', background: 'hsl(145,70%,45%)' }} />
      <Handle type="source" id="failure" position={Position.Bottom} style={{ left: '70%', background: 'hsl(0,75%,55%)' }} />
    </div>
  );
}

function HangupNode({ selected }: NodeProps) {
  return (
    <div style={{
      background: selected ? 'hsl(0,25%,18%)' : 'hsl(0,25%,14%)',
      border: `2px solid ${selected ? 'hsl(0,75%,55%)' : 'hsl(0,25%,28%)'}`,
      borderRadius: '50%', width: 80, height: 80, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      color: 'hsl(0,75%,65%)', fontWeight: 700, fontSize: '0.7rem',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: 'hsl(0,75%,55%)' }} />
      END
    </div>
  );
}

const nodeTypes = { start: StartNode, play: PlayNode, dtmf_collect: DtmfNode, route_agent: RouteAgentNode, transfer: TransferNode, webhook: WebhookNode, hangup: HangupNode };

const NODE_PALETTE = [
  { type: 'play', label: 'Play Audio', icon: '▶' },
  { type: 'dtmf_collect', label: 'Collect DTMF', icon: '🔢' },
  { type: 'route_agent', label: 'Route Agent', icon: '👤' },
  { type: 'transfer', label: 'Forward Call', icon: '📞' },
  { type: 'webhook', label: 'Webhook', icon: '🔗' },
  { type: 'hangup', label: 'End Call', icon: '⊗' },
];

const NEW_FLOW_NODES: Node[] = [
  { id: 'start-1', type: 'start', position: { x: 250, y: 50 }, data: {} },
  { id: 'play-1', type: 'play', position: { x: 180, y: 180 }, data: { label: 'Welcome', audioFile: 'welcome.wav' } },
  { id: 'dtmf-1', type: 'dtmf_collect', position: { x: 150, y: 340 }, data: { timeoutSeconds: 5, maxDigits: 1, branches: [{ digit: '1', nextStepId: 'agent-1' }, { digit: '2', nextStepId: 'hangup-1' }] } },
  { id: 'agent-1', type: 'route_agent', position: { x: 50, y: 540 }, data: { agentSelectionStrategy: 'round_robin' } },
  { id: 'hangup-1', type: 'hangup', position: { x: 360, y: 540 }, data: {} },
];

const NEW_FLOW_EDGES: Edge[] = [
  { id: 'e1', source: 'start-1', target: 'play-1', type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e2', source: 'play-1', target: 'dtmf-1', type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e3', source: 'dtmf-1', target: 'agent-1', label: '1', type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } },
  { id: 'e4', source: 'dtmf-1', target: 'hangup-1', label: '2', type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } },
];

// ---- Main -----------------------------------------------------------------

export default function IvrBuilderCanvasPage() {
  const params = useParams();
  const router = useRouter();
  const flowId = params['id'] as string;
  const isNew = flowId === 'new';

  const [nodes, setNodes, onNodesChange] = useNodesState(NEW_FLOW_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState(NEW_FLOW_EDGES);
  const [flowName, setFlowName] = useState('New IVR Flow');
  const [campaignId, setCampaignId] = useState('');
  const [campaigns, setCampaigns] = useState<Array<{ _id: string; name: string }>>([]);
  const [audioFiles, setAudioFiles] = useState<AudioFileOption[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(!isNew);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const token = () => localStorage.getItem('dialer_access_token') ?? '';

  // Load campaigns + audio files for pickers
  useEffect(() => {
    const t = token();
    Promise.all([
      fetch('/api/campaigns', { headers: { Authorization: `Bearer ${t}` } })
        .then((r) => r.json() as Promise<{ data: Array<{ _id: string; name: string }> }>),
      fetch('/api/asterisk/audio', { headers: { Authorization: `Bearer ${t}` } })
        .then((r) => r.json() as Promise<{ data: AudioFileOption[] }>),
    ]).then(([c, a]) => {
      setCampaigns(c.data ?? []);
      setAudioFiles(a.data ?? []);
    }).catch(console.error);
  }, []);

  // Load existing flow
  useEffect(() => {
    if (isNew) return;
    fetch(`/api/ivr-flows/${flowId}`, { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json() as Promise<{ data: { name: string; campaignId: string; steps: Array<Record<string, unknown>>; entryStepId: string } }>)
      .then(({ data }) => {
        setFlowName(data.name);
        setCampaignId(String(data.campaignId));
        // Convert stored steps back to React Flow nodes
        const loadedNodes: Node[] = (data.steps ?? []).map((s) => ({
          id: String(s['id']),
          type: String(s['type']),
          position: (s['position'] as { x: number; y: number }) ?? { x: 0, y: 0 },
          data: s,
        }));
        if (loadedNodes.length > 0) setNodes(loadedNodes);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [flowId, isNew, setNodes]);

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) => addEdge({ ...connection, type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }, eds)),
    [setEdges],
  );

  const addNode = useCallback((type: string) => {
    const id = `${type}-${Date.now()}`;
    setNodes((nds) => [...nds, {
      id, type,
      position: { x: Math.random() * 400 + 100, y: Math.random() * 300 + 200 },
      data: { label: type.replace('_', ' ') },
    }]);
  }, [setNodes]);

  const updateNodeData = useCallback((nodeId: string, patch: Record<string, unknown>) => {
    setNodes((nds) => nds.map((n) => n.id === nodeId ? { ...n, data: { ...n.data, ...patch } } : n));
    setSelectedNode((prev) => prev?.id === nodeId ? { ...prev, data: { ...prev.data, ...patch } } : prev);
  }, [setNodes]);

  const handleSave = async () => {
    setIsSaving(true);
    setSaveStatus('idle');
    try {
      const steps = nodes.map((n) => ({
        id: n.id, type: n.type, position: n.position,
        nextStepId: edges.find((e) => e.source === n.id && !e.sourceHandle)?.target,
        ...n.data,
      }));
      const startNode = nodes.find((n) => n.type === 'start');
      const payload = { name: flowName, campaignId, entryStepId: startNode?.id ?? '', steps };

      const url = isNew ? '/api/ivr-flows' : `/api/ivr-flows/${flowId}`;
      const method = isNew ? 'POST' : 'PUT';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        setSaveStatus('saved');
        if (isNew) {
          const d = await res.json() as { data: { _id: string } };
          router.replace(`/dashboard/ivr-builder/${d.data._id}`);
        }
        setTimeout(() => setSaveStatus('idle'), 2000);
      } else {
        setSaveStatus('error');
      }
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: 'var(--color-text-muted)' }}>Loading flow...</div>;
  }

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', marginTop: '-32px' }}>
      {/* Top bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 24px', background: 'var(--color-surface-1)',
        borderBottom: '1px solid var(--color-border)', flexShrink: 0, gap: '12px',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <Link href="/dashboard/ivr-builder" style={{ color: 'var(--color-text-muted)', textDecoration: 'none', fontSize: '0.85rem' }}>
            ← Flows
          </Link>
          <span style={{ color: 'var(--color-border)' }}>|</span>
          <input value={flowName} onChange={(e) => setFlowName(e.target.value)}
            style={{
              background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
              borderRadius: '8px', padding: '6px 12px', color: 'var(--color-text-primary)',
              width: '220px', fontSize: '0.875rem',
            }} />
          <select value={campaignId} onChange={(e) => setCampaignId(e.target.value)}
            style={{
              background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
              borderRadius: '8px', padding: '6px 12px', color: 'var(--color-text-primary)', fontSize: '0.875rem',
            }}>
            <option value="">Select campaign...</option>
            {campaigns.map((c) => <option key={c._id} value={c._id}>{c.name}</option>)}
          </select>
        </div>

        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {NODE_PALETTE.map((n) => (
            <button key={n.type} onClick={() => addNode(n.type)} className="btn btn-secondary btn-sm">
              {n.icon} {n.label}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {saveStatus === 'saved' && <span style={{ color: 'var(--color-success)', fontSize: '0.82rem' }}>✓ Saved</span>}
          {saveStatus === 'error' && <span style={{ color: 'var(--color-danger)', fontSize: '0.82rem' }}>✗ Error</span>}
          <button onClick={() => void handleSave()} disabled={isSaving} className="btn btn-primary">
            {isSaving ? 'Saving...' : '💾 Save Flow'}
          </button>
        </div>
      </div>

      {/* Canvas + Properties panel */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 1 }}>
          <ReactFlow
            nodes={nodes} edges={edges}
            onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
            onNodeClick={(_evt, node) => setSelectedNode(node)}
            onPaneClick={() => setSelectedNode(null)}
            nodeTypes={nodeTypes} fitView
            style={{ background: 'hsl(220,20%,10%)' }}
            defaultEdgeOptions={{ style: { stroke: 'hsl(220,40%,50%)', strokeWidth: 2 } }}
          >
            <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="hsl(220,14%,22%)" />
            <Controls style={{ background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: '8px' }} />
            <MiniMap
              style={{ background: 'var(--color-surface-1)', border: '1px solid var(--color-border)' }}
              nodeColor={(n) => ({ start: 'hsl(145,70%,45%)', play: 'hsl(220,75%,50%)', dtmf_collect: 'hsl(265,85%,55%)', route_agent: 'hsl(145,70%,45%)', transfer: 'hsl(190,80%,50%)', webhook: 'hsl(38,90%,55%)', hangup: 'hsl(0,75%,55%)' })[n.type ?? ''] ?? 'hsl(220,14%,30%)'}
            />
          </ReactFlow>
        </div>

        {/* Properties Panel */}
        {selectedNode && selectedNode.type !== 'start' && selectedNode.type !== 'hangup' && (
          <div style={{
            width: 280, flexShrink: 0, background: 'var(--color-surface-1)',
            borderLeft: '1px solid var(--color-border)', overflowY: 'auto', padding: '16px',
            display: 'flex', flexDirection: 'column', gap: '14px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-text-primary)' }}>
                {selectedNode.type?.replace('_', ' ').toUpperCase()} Properties
              </span>
              <button onClick={() => setSelectedNode(null)}
                style={{ background: 'none', border: 'none', color: 'var(--color-text-muted)', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>ID: {selectedNode.id}</div>

            {/* play + dtmf_collect: audio file picker */}
            {(selectedNode.type === 'play' || selectedNode.type === 'dtmf_collect') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Audio File</label>
                <select
                  value={String(selectedNode.data.audioFile ?? '')}
                  onChange={(e) => updateNodeData(selectedNode.id, { audioFile: e.target.value })}
                  style={{
                    background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                    borderRadius: '6px', padding: '6px 8px', color: 'var(--color-text-primary)', fontSize: '0.82rem',
                  }}>
                  <option value="">— None —</option>
                  {audioFiles.map((f) => (
                    <option key={f._id} value={f.asteriskPath}>{f.name} ({f.category})</option>
                  ))}
                </select>
                {selectedNode.data.audioFile && (
                  <div style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)', fontFamily: 'monospace' }}>
                    Asterisk path: {String(selectedNode.data.audioFile)}
                  </div>
                )}
              </div>
            )}

            {/* play: nextStepId (linear) */}
            {selectedNode.type === 'play' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Next Step (after playback)</label>
                <select
                  value={String(selectedNode.data.nextStepId ?? '')}
                  onChange={(e) => updateNodeData(selectedNode.id, { nextStepId: e.target.value })}
                  style={{
                    background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                    borderRadius: '6px', padding: '6px 8px', color: 'var(--color-text-primary)', fontSize: '0.82rem',
                  }}>
                  <option value="">— auto from edge —</option>
                  {nodes.filter((n) => n.id !== selectedNode.id).map((n) => (
                    <option key={n.id} value={n.id}>{n.id} ({n.type})</option>
                  ))}
                </select>
              </div>
            )}

            {/* dtmf_collect: timeout + maxDigits */}
            {selectedNode.type === 'dtmf_collect' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Timeout (seconds)</label>
                  <input type="number" min={1} max={60}
                    value={Number(selectedNode.data.timeoutSeconds ?? 5)}
                    onChange={(e) => updateNodeData(selectedNode.id, { timeoutSeconds: parseInt(e.target.value) || 5 })}
                    style={{
                      background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                      borderRadius: '6px', padding: '6px 8px', color: 'var(--color-text-primary)', fontSize: '0.82rem',
                    }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Max Digits</label>
                  <input type="number" min={1} max={20}
                    value={Number(selectedNode.data.maxDigits ?? 1)}
                    onChange={(e) => updateNodeData(selectedNode.id, { maxDigits: parseInt(e.target.value) || 1 })}
                    style={{
                      background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                      borderRadius: '6px', padding: '6px 8px', color: 'var(--color-text-primary)', fontSize: '0.82rem',
                    }} />
                </div>
              </>
            )}

            {/* transfer: destination + trunk */}
            {selectedNode.type === 'transfer' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Forward To (number / ext)</label>
                  <input
                    placeholder="e.g. 8001 or +12125550100"
                    value={String(selectedNode.data.transferTo ?? '')}
                    onChange={(e) => updateNodeData(selectedNode.id, { transferTo: e.target.value })}
                    style={{
                      background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                      borderRadius: '6px', padding: '6px 8px', color: 'var(--color-text-primary)', fontSize: '0.82rem',
                    }} />
                  <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                    3CX ring group number or any SIP extension/DID
                  </span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Override Trunk (optional)</label>
                  <input
                    placeholder="Leave blank to use campaign trunk"
                    value={String(selectedNode.data.transferTrunk ?? '')}
                    onChange={(e) => updateNodeData(selectedNode.id, { transferTrunk: e.target.value })}
                    style={{
                      background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                      borderRadius: '6px', padding: '6px 8px', color: 'var(--color-text-primary)', fontSize: '0.82rem',
                    }} />
                </div>
              </>
            )}

            {/* route_agent: strategy */}
            {selectedNode.type === 'route_agent' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Agent Selection Strategy</label>
                <select
                  value={String(selectedNode.data.agentSelectionStrategy ?? 'round_robin')}
                  onChange={(e) => updateNodeData(selectedNode.id, { agentSelectionStrategy: e.target.value })}
                  style={{
                    background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                    borderRadius: '6px', padding: '6px 8px', color: 'var(--color-text-primary)', fontSize: '0.82rem',
                  }}>
                  <option value="round_robin">Round Robin</option>
                  <option value="least_busy">Least Busy</option>
                  <option value="random">Random</option>
                </select>
              </div>
            )}

            {/* webhook: url + method */}
            {selectedNode.type === 'webhook' && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Webhook URL</label>
                  <input
                    placeholder="https://…"
                    value={String(selectedNode.data.webhookUrl ?? '')}
                    onChange={(e) => updateNodeData(selectedNode.id, { webhookUrl: e.target.value })}
                    style={{
                      background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                      borderRadius: '6px', padding: '6px 8px', color: 'var(--color-text-primary)', fontSize: '0.82rem',
                    }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>Method</label>
                  <select
                    value={String(selectedNode.data.webhookMethod ?? 'POST')}
                    onChange={(e) => updateNodeData(selectedNode.id, { webhookMethod: e.target.value })}
                    style={{
                      background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
                      borderRadius: '6px', padding: '6px 8px', color: 'var(--color-text-primary)', fontSize: '0.82rem',
                    }}>
                    <option value="POST">POST</option>
                    <option value="GET">GET</option>
                  </select>
                </div>
              </>
            )}

            <button
              onClick={() => {
                if (!confirm('Remove this node?')) return;
                setNodes((nds) => nds.filter((n) => n.id !== selectedNode.id));
                setEdges((eds) => eds.filter((e) => e.source !== selectedNode.id && e.target !== selectedNode.id));
                setSelectedNode(null);
              }}
              style={{
                marginTop: 8, padding: '6px 12px', borderRadius: '6px', fontSize: '0.78rem',
                background: 'hsl(0,40%,20%)', border: '1px solid hsl(0,50%,35%)',
                color: 'hsl(0,75%,70%)', cursor: 'pointer',
              }}>
              🗑 Remove node
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
