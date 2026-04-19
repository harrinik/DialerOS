import { NextResponse, type NextRequest } from 'next/server';
import { ariGet, pjsipPut, pjsipDelete } from '@/lib/asterisk/ari-client';
import { withUser } from '@/lib/auth/rbac';
import type { JwtPayload } from '@/lib/auth/jwt';

type Params = { params: { id: string } };

export const GET = withUser(async (_req: NextRequest, _user: JwtPayload, { params }: Params) => {
  try {
    const [endpoint, contacts] = await Promise.all([
      ariGet(`/endpoints/PJSIP/${params.id}`),
      ariGet(`/endpoints/PJSIP/${params.id}/sendMessage`).catch(() => null),
    ]);
    return NextResponse.json({ data: { endpoint, contacts } });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502 });
  }
});

export const PUT = withUser(async (req: NextRequest, _user: JwtPayload, { params }: Params) => {
  const body = await req.json() as {
    displayName?: string;
    password?: string;
    codecs?: string[];
    maxContacts?: number;
    dtmfMode?: string;
    directMedia?: boolean;
  };
  const id = params.id;
  try {
    if (body.password) {
      await pjsipPut('res_pjsip', 'auth', id, [
        { attribute: 'auth_type', value: 'userpass' },
        { attribute: 'username',  value: id },
        { attribute: 'password',  value: body.password },
      ]);
    }
    if (body.maxContacts !== undefined) {
      await pjsipPut('res_pjsip', 'aor', id, [
        { attribute: 'max_contacts', value: String(body.maxContacts) },
      ]);
    }
    const endpointFields: Array<{ attribute: string; value: string }> = [];
    if (body.displayName) endpointFields.push({ attribute: 'callerid', value: `"${body.displayName}" <${id}>` });
    if (body.codecs) {
      endpointFields.push({ attribute: 'disallow', value: 'all' });
      endpointFields.push({ attribute: 'allow', value: body.codecs.join(',') });
    }
    if (body.dtmfMode) endpointFields.push({ attribute: 'dtmf_mode', value: body.dtmfMode });
    if (body.directMedia !== undefined) endpointFields.push({ attribute: 'direct_media', value: body.directMedia ? 'yes' : 'no' });
    if (endpointFields.length) await pjsipPut('res_pjsip', 'endpoint', id, endpointFields);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
});

export const DELETE = withUser(async (_req: NextRequest, _user: JwtPayload, { params }: Params) => {
  const id = params.id;
  try {
    await Promise.all([
      pjsipDelete('res_pjsip', 'endpoint', id),
      pjsipDelete('res_pjsip', 'auth', id),
      pjsipDelete('res_pjsip', 'aor', id),
      pjsipDelete('res_pjsip', 'registration', id).catch(() => null),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 502 });
  }
});
