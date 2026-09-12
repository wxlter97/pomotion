import type { VercelRequest, VercelResponse } from '@vercel/node';
import { sendError } from './_lib/errors.js';
import { withAuth } from './_lib/handler.js';
import { sqliteStore } from './_lib/sqliteStore.js';

async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method === 'GET') {
      const files = await sqliteStore.listFiles();
      return res.status(200).json({ files });
    }

    if (req.method === 'POST') {
      const body = (req.body ?? {}) as {
        action?: string;
        id?: string;
        label?: string;
        type?: string;
      };
      if (body.action === 'create_context') {
        const context = await sqliteStore.createContext({ label: body.label, type: body.type });
        return res.status(200).json({ ok: true, context });
      }
      if (body.action === 'update_context') {
        const context = await sqliteStore.updateContext({
          id: body.id,
          label: body.label,
          type: body.type,
        });
        return res.status(200).json({ ok: true, context });
      }
      if (body.action === 'delete_context') {
        await sqliteStore.deleteContext(body.id);
        return res.status(200).json({ ok: true });
      }
      res.setHeader('Allow', 'GET, POST');
      return res.status(400).json({ error: 'unknown_action' });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  } catch (err) {
    return sendError(res, err);
  }
}

export default withAuth(handler);
