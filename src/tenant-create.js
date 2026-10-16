import {randomBytes} from 'node:crypto';

/** Generate inside the registry queue; retained data/log folders reserve their IDs. */
export function generateTenant(name, entries, random = randomBytes, isTaken = () => false) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) throw new Error('Name is required and must be 1-100 characters after trimming');
  name = name.trim();
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/g, '') || 'instance';
  const ids = new Set(entries.map(entry => entry.id));
  let id = slug;
  for (let suffix = 2; ids.has(id) || isTaken(id); suffix++) id = `${slug}-${suffix}`;
  const keys = new Set(entries.map(entry => entry.clientId));
  let clientId;
  do { clientId = `dam-${id}-${random(4).toString('hex')}`; } while (keys.has(clientId));
  return {id, name, clientId, clientSecret: random(32).toString('base64'), graph: {}};
}
