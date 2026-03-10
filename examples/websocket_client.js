/**
 * Example WebSocket collaboration client for Giga-PDF (JavaScript/Node.js).
 *
 * This example demonstrates how to connect to the Giga-PDF collaboration
 * server and interact with other users in real-time.
 *
 * Installation:
 *   npm install socket.io-client
 *
 * Usage:
 *   node examples/websocket_client.js --document-id <uuid> --token <jwt>
 */

const io = require('socket.io-client');

/**
 * WebSocket collaboration client for Giga-PDF.
 */
class CollaborationClient {
  /**
   * Initialize collaboration client.
   *
   * @param {string} serverUrl - WebSocket server URL (e.g., http://localhost:8000/ws)
   * @param {string} documentId - Document UUID to collaborate on
   * @param {string} authToken - JWT authentication token
   */
  constructor(serverUrl, documentId, authToken) {
    this.serverUrl = serverUrl;
    this.documentId = documentId;
    this.authToken = authToken;
    this.sessionId = null;
    this.userColor = null;
    this.activeUsers = new Map();
    this.lockedElements = new Set();

    this.socket = io(serverUrl, {
      auth: {
        token: authToken,
      },
      transports: ['websocket', 'polling'],
    });

    this.setupEventHandlers();
  }

  /**
   * Set up Socket.IO event handlers.
   */
  setupEventHandlers() {
    // Connection events
    this.socket.on('connect', () => {
      console.log('Connected to collaboration server');
      this.joinDocument();
    });

    this.socket.on('disconnect', () => {
      console.log('Disconnected from collaboration server');
      this.activeUsers.clear();
      this.lockedElements.clear();
    });

    this.socket.on('connect_error', (error) => {
      console.error('Connection error:', error.message);
    });

    // User presence events
    this.socket.on('user:joined', (data) => {
      const { user_id, user_name, user_color } = data;

      this.activeUsers.set(user_id, {
        name: user_name,
        color: user_color,
      });

      console.log(`User joined: ${user_name} (${user_id}) with color ${user_color}`);
    });

    this.socket.on('user:left', (data) => {
      const { user_id, user_name } = data;

      this.activeUsers.delete(user_id);

      console.log(`User left: ${user_name} (${user_id})`);
    });

    // Element locking events
    this.socket.on('element:locked', (data) => {
      const { element_id, locked_by_user_name, expires_at } = data;

      this.lockedElements.add(element_id);

      console.log(`Element ${element_id} locked by ${locked_by_user_name} until ${expires_at}`);
    });

    this.socket.on('element:unlocked', (data) => {
      const { element_id } = data;

      this.lockedElements.delete(element_id);

      console.log(`Element ${element_id} unlocked`);
    });

    // Cursor tracking
    this.socket.on('cursor:moved', (data) => {
      const { user_id, user_name, page, x, y } = data;

      console.debug(`Cursor from ${user_name}: page ${page}, position (${x.toFixed(1)}, ${y.toFixed(1)})`);
    });

    // Document updates
    this.socket.on('document:updated', (data) => {
      const { user_name, update_type, affected_elements = [], affected_pages = [] } = data;

      console.log(
        `Document updated by ${user_name}: ${update_type} ` +
        `(elements: ${affected_elements.length}, pages: ${affected_pages})`
      );
    });
  }

  /**
   * Join the document collaboration room.
   */
  async joinDocument() {
    console.log(`Joining document ${this.documentId}...`);

    return new Promise((resolve, reject) => {
      this.socket.emit('join_document', { document_id: this.documentId }, (response) => {
        if (response.success) {
          this.sessionId = response.session.session_id;
          this.userColor = response.session.user_color;

          console.log('Joined document successfully!');
          console.log(`Session ID: ${this.sessionId}`);
          console.log(`Your color: ${this.userColor}`);

          // Log active users
          const activeUsers = response.active_users || [];
          if (activeUsers.length > 0) {
            console.log(`Active users (${activeUsers.length}):`);
            activeUsers.forEach((user) => {
              console.log(`  - ${user.user_name} (${user.user_id}) with color ${user.user_color}`);
              this.activeUsers.set(user.user_id, {
                name: user.user_name,
                color: user.user_color,
              });
            });
          } else {
            console.log('You are the first user in this document');
          }

          // Log active locks
          const activeLocks = response.active_locks || [];
          if (activeLocks.length > 0) {
            console.log(`Active locks (${activeLocks.length}):`);
            activeLocks.forEach((lock) => {
              console.log(`  - Element ${lock.element_id} locked by ${lock.locked_by_user_id}`);
              this.lockedElements.add(lock.element_id);
            });
          }

          resolve(response);
        } else {
          const error = response.error || 'Unknown error';
          console.error(`Failed to join document: ${error}`);
          reject(new Error(error));
        }
      });
    });
  }

  /**
   * Leave the document collaboration room.
   */
  async leaveDocument() {
    console.log('Leaving document...');

    return new Promise((resolve, reject) => {
      this.socket.emit('leave_document', {}, (response) => {
        if (response.success) {
          console.log('Left document successfully');
          this.activeUsers.clear();
          this.lockedElements.clear();
          resolve(response);
        } else {
          const error = response.error || 'Unknown error';
          console.error(`Failed to leave document: ${error}`);
          reject(new Error(error));
        }
      });
    });
  }

  /**
   * Lock an element for editing.
   *
   * @param {string} elementId - Element UUID to lock
   * @returns {Promise<boolean>} True if lock acquired
   */
  async lockElement(elementId) {
    console.log(`Locking element ${elementId}...`);

    return new Promise((resolve) => {
      this.socket.emit('element:lock', { element_id: elementId }, (response) => {
        if (response.success) {
          console.log(`Element locked until ${response.lock.expires_at}`);
          this.lockedElements.add(elementId);
          resolve(true);
        } else {
          const error = response.error || 'Unknown error';
          const lockedBy = response.locked_by;
          const expiresAt = response.expires_at;

          console.warn(
            `Failed to lock element: ${error} ` +
            `(locked by ${lockedBy} until ${expiresAt})`
          );
          resolve(false);
        }
      });
    });
  }

  /**
   * Unlock an element.
   *
   * @param {string} elementId - Element UUID to unlock
   */
  async unlockElement(elementId) {
    console.log(`Unlocking element ${elementId}...`);

    return new Promise((resolve, reject) => {
      this.socket.emit('element:unlock', { element_id: elementId }, (response) => {
        if (response.success) {
          console.log('Element unlocked successfully');
          this.lockedElements.delete(elementId);
          resolve(response);
        } else {
          const error = response.error || 'Unknown error';
          console.warn(`Failed to unlock element: ${error}`);
          reject(new Error(error));
        }
      });
    });
  }

  /**
   * Broadcast cursor position.
   *
   * @param {number} page - Current page number
   * @param {number} x - X coordinate
   * @param {number} y - Y coordinate
   */
  moveCursor(page, x, y) {
    this.socket.emit('cursor:move', { page, x, y });
    console.debug(`Cursor moved to page ${page}, position (${x}, ${y})`);
  }

  /**
   * Broadcast a document update.
   *
   * @param {string} updateType - Type of update
   * @param {string[]} affectedElements - List of affected element UUIDs
   * @param {number[]} affectedPages - List of affected page numbers
   * @param {object} data - Additional update data
   */
  broadcastUpdate(updateType, affectedElements, affectedPages, data) {
    this.socket.emit('document:update', {
      update_type: updateType,
      affected_elements: affectedElements,
      affected_pages: affectedPages,
      timestamp: new Date().toISOString(),
      data: data,
    });

    console.log(
      `Broadcast update: ${updateType} ` +
      `(elements: ${affectedElements.length}, pages: ${affectedPages})`
    );
  }

  /**
   * Disconnect from the server.
   */
  disconnect() {
    console.log('Disconnecting...');
    this.socket.disconnect();
  }
}

/**
 * Sleep utility function.
 *
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Main entry point for the example client.
 */
async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  const serverUrl = getArg(args, '--server-url', 'http://localhost:8000/ws');
  const documentId = getArg(args, '--document-id');
  const token = getArg(args, '--token');
  const runDemo = args.includes('--demo');

  if (!documentId) {
    console.error('Error: --document-id is required');
    console.log('Usage: node websocket_client.js --document-id <uuid> --token <jwt> [--demo]');
    process.exit(1);
  }

  if (!token) {
    console.error('Error: --token is required');
    console.log('Usage: node websocket_client.js --document-id <uuid> --token <jwt> [--demo]');
    process.exit(1);
  }

  // Create client
  const client = new CollaborationClient(serverUrl, documentId, token);

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nReceived interrupt, cleaning up...');
    client.disconnect();
    process.exit(0);
  });

  // Wait for connection
  await sleep(2000);

  if (runDemo) {
    console.log('\n=== Running demo interactions ===\n');

    // Move cursor around
    console.log('Moving cursor...');
    for (let i = 0; i < 5; i++) {
      client.moveCursor(1, 100 + i * 10, 200 + i * 10);
      await sleep(1000);
    }

    // Try to lock an element
    console.log('\nTrying to lock element...');
    const testElementId = 'test-element-uuid';
    const locked = await client.lockElement(testElementId);

    if (locked) {
      // Broadcast an update
      console.log('\nBroadcasting update...');
      client.broadcastUpdate(
        'element_modified',
        [testElementId],
        [1],
        {
          element_id: testElementId,
          property: 'text',
          value: 'Updated text from demo',
        }
      );

      await sleep(2000);

      // Unlock the element
      await client.unlockElement(testElementId);
    }

    console.log('\n=== Demo complete ===\n');
    console.log('Press Ctrl+C to exit');
  }
}

/**
 * Get command line argument value.
 *
 * @param {string[]} args - Command line arguments
 * @param {string} name - Argument name
 * @param {string} defaultValue - Default value if not found
 * @returns {string|undefined}
 */
function getArg(args, name, defaultValue = undefined) {
  const index = args.indexOf(name);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }
  return defaultValue;
}

// Run main function
if (require.main === module) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { CollaborationClient };
