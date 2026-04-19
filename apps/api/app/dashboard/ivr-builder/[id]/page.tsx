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

const nodeTypes = { start: StartNode, play: PlayNode, dtmf_collect: DtmfNode, route_agent: RouteAgentNode, webhook: WebhookNode, hangup: HangupNode };

const NODE_PALETTE = [
  { type: 'play', label: 'Play Audio', icon: '▶' },
  { type: 'dtmf_collect', label: 'Collect DTMF', icon: '🔢' },
  { type: 'route_agent', label: 'Route Agent', icon: '👤' },
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
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(!isNew);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  const token = () => localStorage.getItem('dialer_access_token') ?? '';

  // Load campaigns for the picker
  useEffect(() => {
    fetch('/api/campaigns', { headers: { Authorization: `Bearer ${token()}` } })
      .then((r) => r.json() as Promise<{ data: Array<{ _id: string; name: string }> }>)
      .then((d) => setCampaigns(d.data ?? []))
      .catch(console.error);
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

      {/* Canvas */}
      <div style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect}
          nodeTypes={nodeTypes} fitView
          style={{ background: 'hsl(220,20%,10%)' }}
          defaultEdgeOptions={{ style: { stroke: 'hsl(220,40%,50%)', strokeWidth: 2 } }}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="hsl(220,14%,22%)" />
          <Controls style={{ background: 'var(--color-surface-1)', border: '1px solid var(--color-border)', borderRadius: '8px' }} />
          <MiniMap
            style={{ background: 'var(--color-surface-1)', border: '1px solid var(--color-border)' }}
            nodeColor={(n) => ({ start: 'hsl(145,70%,45%)', play: 'hsl(220,75%,50%)', dtmf_collect: 'hsl(265,85%,55%)', route_agent: 'hsl(145,70%,45%)', webhook: 'hsl(38,90%,55%)', hangup: 'hsl(0,75%,55%)' })[n.type ?? ''] ?? 'hsl(220,14%,30%)'}
          />
        </ReactFlow>
      </div>
    </div>
  );
}
