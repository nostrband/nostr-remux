import NDK, { NDKFilter, NDKEvent, NDKNip07Signer, NDKRelaySet } from "@nostr-dev-kit/ndk";
import { nip19 } from 'nostr-tools'

const readRelays = ["wss://relay.nostr.band/all", "wss://nos.lol", "wss://relay.damus.io"];
const writeRelays = [...readRelays, "wss://nostr.mutinywallet.com"] // for broadcasting

let ndkObject = null;

let onNostrHandlers = [];
let nostrEnabled = false;


export async function addOnNostr(handler) {
  
  if (nostrEnabled)
    await handler();
  else
    onNostrHandlers.push(handler);
}

export async function onAuthed(handler) {
  // not the current authed state
  const wasAuthed = isAuthed();
  await handler();

  // after nostr extension is ready, recheck the
  // authed state and reload if needed
  addOnNostr(async () => {
    if (wasAuthed !== isAuthed ())
      await handler();
  });
}

export function enableNostr() {
  return new Promise(function (ok) {

    // check window.nostr periodically, backoff exponentially,
    // and if we've detected window.nostr give it a bit more time
    // to init
    let period = 100;
    let hasNostr = false;
    async function checkNostr() {
      if (hasNostr) {

	nostrEnabled = true;

	// reconnect
	if (ndkObject) {
	  ndkObject.signer = new NDKNip07Signer();
	}

	// execute handlers
	for (const h of onNostrHandlers)
	  await h();
	
	ok ();
      } else {
	if (window.nostr) {
	  hasNostr = true;
	  // wait until it initializes
	  setTimeout(checkNostr, 500);
	} else {
	  period *= 2;
	  setTimeout(checkNostr, period);
	}
      }
    }

    // start it
    checkNostr();
  });
}

async function createConnectNDK (custom_relays) {

  // FIXME the issue is that NDK would return EOSE even if some dumb relay
  // returns EOSE immediately w/o returning anything, while others are trying to stream the
  // data, which takes some time. And so instead of getting a merged result from
  // several relays, you get truncated result from just one of them
  
  const relays = [...new Set([...readRelays, ...writeRelays])];
  if (custom_relays)
    relays.push(...custom_relays);
  const nip07signer = nostrEnabled ? new NDKNip07Signer() : null;
  ndkObject = new NDK({ explicitRelayUrls: relays, signer: nip07signer });
  console.log("ndk connecting, signer", nip07signer != null);
  await ndkObject.connect();
}

export async function getNDK (relays) {
  if (ndkObject) {    
    // FIXME add relays to the pool
    return ndkObject;
  }

  return new Promise(async function (ok) {
    await createConnectNDK(relays);
    ok(ndkObject);
  });
}

function startFetch(ndk, filter) {
  const relaySet = NDKRelaySet.fromRelayUrls(readRelays, ndk);

  // have to reimplement the ndk's fetchEvents method to allow:
  // - relaySet - only read relays to exclude the mutiny relay that returns EOSE on everything which
  // breaks the NDK's internal EOSE handling (sends eose too early assuming this "fast" relay has sent all we need)
  // - turn of NDK's dedup logic bcs it is faulty (doesn't handle 0, 3, 10k)
  return new Promise((resolve) => {
    const events = [];
    const opts = {};
    const relaySetSubscription = ndk.subscribe(filter, { ...opts, closeOnEose: true }, relaySet);
    relaySetSubscription.on("event", (event) => {
      event.ndk = this;
      events.push(event);
    });
    relaySetSubscription.on("eose", () => {
      resolve(events);
    });
  });

  //  return ndk.fetchEvents(filter, opts);
}

export function getTags(e, name) {
  return e.tags.filter(t => t.length > 0 && t[0] === name);
}

export function getTag(e, name) {
  const tags = getTags(e, name);
  if (tags.length === 0)
    return null;
  return tags[0];
}

export function getTagValue(e, name, index, def) {
  const tag = getTag(e, name);
  if (tag === null || !tag.length || (index && index >= tag.length)) return def !== undefined ? def : "";
  return tag[1 + (index || 0)];
}

export function getEventTagA(e) {
  let addr = e.kind + ":" + e.pubkey + ":";
  if (e.kind >= 30000 && e.kind < 40000)
    addr += getTagValue (e, "d");
  return addr;
}

export function naddrToAddr(naddr) {
  const {type, data} = nip19.decode(naddr);
  if (type !== "naddr")
    return "";
  return data.kind + ":" + data.pubkey + ":" + data.identifier;
}

export function getEventAddr(e) {
  return {
    kind: e.kind,
    pubkey: e.pubkey,
    identifier: getTagValue(e, "d"),
  }
}

export function formatNpubShort(pubkey) {
  const npub = nip19.npubEncode(pubkey);
  return npub.substring(0, 12) + "..." + npub.substring(npub.length - 4);
}

export function formatNpub(pubkey) {
  return nip19.npubEncode(pubkey);
}

export function formatNaddr(addr) {
  return nip19.naddrEncode(addr);
}

export function getNaddr(e) {
  return nip19.naddrEncode(getEventAddr(e));
}

export function dedupEvents(events) {

  const map = {};
  for (const e of events) {
    let addr = e.id;
    if (e.kind === 0
	|| e.kind === 3
	|| (e.kind >= 10000 && e.kind < 20000)
	|| (e.kind >= 30000 && e.kind < 40000)) {

      addr = getEventTagA(e);
    }

    if (!(addr in map) || map[addr].created_at < e.created_at) {
      map[addr] = e;
    }
  }

  return Object.values(map);
}

async function fetchAllEvents(reqs) {
  const results = await Promise.allSettled(reqs);
  console.log("results", results.length);
  
  let events = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      if (r.value !== null) {
	if (typeof r.value[Symbol.iterator] === 'function')
	  events.push(...r.value);
	else
	  events.push(r.value);
      }
    }
  }

  return dedupEvents(events);
}

function cleanEvents(events) {
  const clean = [];
  for (const e of events) {
    clean.push({
      id: e.id,
      pubkey: e.pubkey,
      kind: e.kind,
      created_at: e.created_at,
      tags: e.tags,
      content: e.content,
      sig: e.sig,
      naddr: getNaddr(e),
    });
  }
  return clean;
}

export async function getPosts() {

  const ndk = await getNDK();
  
  const filter = {
    kinds: [30023],
    limit: 10,
  };

  const reqs = [startFetch(ndk, filter)];
    
  const events = await fetchAllEvents(reqs);
//  console.log("events", events);

  return cleanEvents(events);
}

export async function getPost(naddr) {
  const {type, data} = nip19.decode(naddr);
  if (type !== "naddr")
    return null;

  const ndk = await getNDK();
    
  const events = await fetchAllEvents([startFetch(ndk, {
    authors: [data.pubkey],
    kinds: [data.kind],
    '#d': [data.identifier]
  })]);

  return events.length ? cleanEvents(events)[0] : null;
}

