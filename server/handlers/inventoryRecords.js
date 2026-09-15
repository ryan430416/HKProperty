import { getStaffClient } from '../pb.js';
import { clientError, json, methodNotAllowed, readJson, safeError } from '../http.js';
import { INVENTORY_RESULTS, INVENTORY_SESSION_STATUS } from '../status.js';

export default async function handler(req, res) {
  try {
    const { client, user } = await getStaffClient(req.headers.authorization);
    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://localhost');
      const sessionId = String(url.searchParams.get('sessionId') || '').trim();
      if (!sessionId) return clientError(res, 400, 'session_required');
      const session = await client.collection('hkp_inventory_sessions').getOne(sessionId);
      const records = await client.collection('hkp_inventory_records').getFullList({
        filter: `session = "${sessionId}"`,
        expand: 'asset',
        sort: '-checked_at'
      });
      const assetsTotal = (await client.collection('hkp_assets').getList(1, 1, {
        filter: 'is_active = true && (deleted_at = "" || deleted_at = null)'
      })).totalItems;
      const checked = records.length;
      const abnormal = records.filter((r) => r.result !== '正常').length;
      return json(res, 200, {
        session,
        summary: {
          assetsTotal,
          checked,
          unchecked: Math.max(0, assetsTotal - checked),
          abnormal
        },
        items: records.map((r) => ({
          id: r.id,
          assetId: r.asset,
          propertyId: r.expand?.asset?.property_id || '',
          name: r.expand?.asset?.name || '',
          bookLocation: r.expand?.asset?.location || '',
          recordedLocation: r.recorded_location,
          result: r.result,
          note: r.note || '',
          checkedAt: r.checked_at
        }))
      });
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const sessionId = String(body.sessionId || '').trim();
      const assetId = String(body.assetId || '').trim();
      const recordedLocation = String(body.recordedLocation || '').trim();
      const result = String(body.result || '').trim();
      if (!sessionId || !assetId || !recordedLocation || !result) return clientError(res, 400, 'fields_required');
      if (!INVENTORY_RESULTS.includes(result)) return clientError(res, 400, 'result_invalid');
      const session = await client.collection('hkp_inventory_sessions').getOne(sessionId);
      if (session.status !== INVENTORY_SESSION_STATUS.OPEN) return clientError(res, 409, 'session_closed');
      const asset = await client.collection('hkp_assets').getOne(assetId);
      // Do not auto-change checkout availability from inventory.
      let row;
      try {
        row = await client.collection('hkp_inventory_records').create({
          session: sessionId,
          asset: assetId,
          recorded_location: recordedLocation,
          result,
          note: String(body.note || '').trim(),
          checked_by: user.id,
          checked_at: new Date().toISOString()
        });
      } catch {
        const existing = await client.collection('hkp_inventory_records').getFirstListItem(
          `session = "${sessionId}" && asset = "${assetId}"`
        );
        row = await client.collection('hkp_inventory_records').update(existing.id, {
          recorded_location: recordedLocation,
          result,
          note: String(body.note || '').trim(),
          checked_by: user.id,
          checked_at: new Date().toISOString()
        });
      }
      await client.collection('hkp_assets').update(assetId, {
        last_audit_at: new Date().toISOString(),
        audit_status: result,
        current_location: recordedLocation
      }).catch(() => {});
      return json(res, 200, {
        item: row,
        asset: {
          id: asset.id,
          propertyId: asset.property_id,
          name: asset.name,
          location: asset.location,
          availabilityStatus: asset.availability_status
        }
      });
    }
    return methodNotAllowed(res);
  } catch (error) {
    return safeError(res, error);
  }
}
