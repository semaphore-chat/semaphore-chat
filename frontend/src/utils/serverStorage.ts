/**
 * Server Storage Utility
 *
 * Manages multiple Semaphore Chat server instances in localStorage.
 * Supports multi-server switching.
 */

import { logger } from './logger';

export interface Server {
  id: string;
  name: string;
  url: string;
  isActive: boolean;
  iconUrl?: string;
  lastConnected?: string;
}

const SERVERS_KEY = 'semaphore:servers';
const ACTIVE_SERVER_KEY = 'semaphore:activeServerId';

/**
 * Get all saved servers from localStorage
 */
export function getServers(): Server[] {
  try {
    const serversJson = localStorage.getItem(SERVERS_KEY);
    if (!serversJson) {
      return [];
    }
    return JSON.parse(serversJson);
  } catch (error) {
    logger.error('Failed to load servers from localStorage:', error);
    return [];
  }
}

/**
 * Get the currently active server
 */
export function getActiveServer(): Server | null {
  const servers = getServers();
  const activeServerId = localStorage.getItem(ACTIVE_SERVER_KEY);

  if (activeServerId) {
    const server = servers.find(s => s.id === activeServerId);
    if (server) {
      return server;
    }
  }

  // Fallback to first server marked as active
  const activeServer = servers.find(s => s.isActive);
  if (activeServer) {
    localStorage.setItem(ACTIVE_SERVER_KEY, activeServer.id);
    return activeServer;
  }

  // If no active server, return first server
  if (servers.length > 0) {
    return servers[0];
  }

  return null;
}

/**
 * Save servers array to localStorage
 */
function saveServers(servers: Server[]): void {
  try {
    localStorage.setItem(SERVERS_KEY, JSON.stringify(servers));
  } catch (error) {
    logger.error('Failed to save servers to localStorage:', error);
    throw error;
  }
}

/**
 * Add a new server
 */
export function addServer(name: string, url: string): Server {
  const servers = getServers();

  // Normalize URL (remove trailing slash)
  const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;

  // Check if server already exists
  const existingServer = servers.find(s => s.url === normalizedUrl);
  if (existingServer) {
    throw new Error('Server already exists');
  }

  const newServer: Server = {
    id: crypto.randomUUID(),
    name,
    url: normalizedUrl,
    isActive: servers.length === 0, // First server is active by default
    lastConnected: new Date().toISOString(),
  };

  servers.push(newServer);
  saveServers(servers);

  // Set as active if it's the first server
  if (servers.length === 1) {
    localStorage.setItem(ACTIVE_SERVER_KEY, newServer.id);
  }

  return newServer;
}

/**
 * Remove a server by ID
 */
export function removeServer(serverId: string): void {
  let servers = getServers();
  const serverToRemove = servers.find(s => s.id === serverId);

  if (!serverToRemove) {
    throw new Error('Server not found');
  }

  servers = servers.filter(s => s.id !== serverId);
  saveServers(servers);

  // If removed server was active, set first server as active
  const activeServerId = localStorage.getItem(ACTIVE_SERVER_KEY);
  if (activeServerId === serverId && servers.length > 0) {
    setActiveServer(servers[0].id);
  } else if (servers.length === 0) {
    localStorage.removeItem(ACTIVE_SERVER_KEY);
  }
}

/**
 * Set a server as active
 */
export function setActiveServer(serverId: string): Server {
  const servers = getServers();
  const server = servers.find(s => s.id === serverId);

  if (!server) {
    throw new Error('Server not found');
  }

  // Update isActive flag for all servers
  servers.forEach(s => {
    s.isActive = s.id === serverId;
    if (s.id === serverId) {
      s.lastConnected = new Date().toISOString();
    }
  });

  saveServers(servers);
  localStorage.setItem(ACTIVE_SERVER_KEY, serverId);

  return server;
}

/**
 * Make `url` the active server: the saved one with that URL, or a new one.
 */
export function addOrActivateServer(name: string, url: string): Server {
  const normalizedUrl = url.endsWith('/') ? url.slice(0, -1) : url;
  const existing = getServers().find(s => s.url === normalizedUrl);
  const server = existing ?? addServer(name, normalizedUrl);
  return setActiveServer(server.id);
}

/**
 * Update server properties
 */
export function updateServer(serverId: string, updates: Partial<Omit<Server, 'id'>>): Server {
  const servers = getServers();
  const serverIndex = servers.findIndex(s => s.id === serverId);

  if (serverIndex === -1) {
    throw new Error('Server not found');
  }

  servers[serverIndex] = {
    ...servers[serverIndex],
    ...updates,
  };

  saveServers(servers);
  return servers[serverIndex];
}

/**
 * Check if any servers are configured
 */
export function hasServers(): boolean {
  return getServers().length > 0;
}

/**
 * Clear all servers (useful for testing/reset)
 */
export function clearAllServers(): void {
  localStorage.removeItem(SERVERS_KEY);
  localStorage.removeItem(ACTIVE_SERVER_KEY);
}
