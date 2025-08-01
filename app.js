/*
 * TorchTime client-side application.
 *
 * This script powers a minimal D&D scheduling and campaign management tool
 * that runs entirely in the browser. It uses localStorage to persist
 * state across sessions. The architecture is deliberately simple so it
 * can run without any external dependencies or build tools. In a real
 * deployment you'd likely split this into multiple modules and replace
 * localStorage with a proper backend.
 */

(() => {
  // ----- Utilities -----
  const $ = (selector) => document.querySelector(selector);

  /**
   * Load application state from localStorage. If nothing is stored yet
   * return sensible defaults.
   */
  function loadState() {
    try {
      const raw = localStorage.getItem('torchtimeData');
      if (!raw) {
        return {
          users: [],
          campaigns: [],
          sessions: [],
          currentUserId: null,
        };
      }
      return JSON.parse(raw);
    } catch (err) {
      console.error('Failed to parse state', err);
      return {
        users: [],
        campaigns: [],
        sessions: [],
        currentUserId: null,
      };
    }
  }

  /**
   * Persist application state to localStorage.
   * @param {object} state The state to store.
   */
  function saveState(state) {
    localStorage.setItem('torchtimeData', JSON.stringify(state));
  }

  /**
   * Generate a unique identifier. In production you'd use database IDs.
   */
  function uuid() {
    return (
      Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
    );
  }

  /**
   * Format a Date object into a locale string suitable for display.
   * Shows date and time in the user's locale.
   * @param {Date|string} date
   */
  function formatDateTime(date) {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  }

  /**
   * Compare two proposed times by vote counts (descending), then by date (ascending).
   */
  function compareProposedTimes(a, b) {
    const votesA = a.votes.length;
    const votesB = b.votes.length;
    if (votesA !== votesB) return votesB - votesA;
    return new Date(a.datetime) - new Date(b.datetime);
  }

  /**
   * Render the navigation bar depending on login state and current view.
   */
  function renderNav(state) {
    const nav = $('#nav');
    nav.innerHTML = '';
    if (!state.currentUserId) {
      nav.innerHTML =
        '<a href="#login" class="active">Login</a>' +
        '<a href="#register">Register</a>';
      return;
    }
    const user = state.users.find((u) => u.id === state.currentUserId);
    const links = [
      { href: '#dashboard', label: 'Campaigns' },
      { href: '#create-campaign', label: 'New Campaign' },
      { href: '#timer', label: 'Timer' },
      { href: '#logout', label: 'Logout' },
    ];
    links.forEach(({ href, label }) => {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = label;
      if (window.location.hash === href) {
        a.classList.add('active');
      }
      nav.appendChild(a);
    });
    // Show current user name
    const span = document.createElement('span');
    span.textContent = `Welcome, ${user.username}`;
    span.style.marginLeft = '1rem';
    nav.appendChild(span);
  }

  /**
   * Entry point: called once on page load.
   */
  function init() {
    // Display current year in footer
    $('#year').textContent = new Date().getFullYear();
    // Load state from localStorage
    const state = loadState();
    // Setup hash change listener
    window.addEventListener('hashchange', () => {
      render(state);
    });
    // Initial render
    render(state);
  }

  /**
   * Main render function. Decides which view to display based on the hash.
   * @param {object} state
   */
  function render(state) {
    renderNav(state);
    const app = $('#app');
    const hash = window.location.hash || '#dashboard';
    if (!state.currentUserId) {
      if (hash === '#register') {
        renderRegister(app, state);
      } else {
        renderLogin(app, state);
      }
      return;
    }
    // Logged in
    switch (hash) {
      case '#create-campaign':
        renderCreateCampaign(app, state);
        break;
      case '#campaign':
        renderCampaignDetail(app, state);
        break;
      case '#session':
        renderSessionDetail(app, state);
        break;
      case '#timer':
        renderTimer(app, state);
        break;
      case '#logout':
        handleLogout(state);
        break;
      default:
        renderDashboard(app, state);
        break;
    }
  }

  /**
   * Render login form for unauthenticated users.
   */
  function renderLogin(container, state) {
    container.innerHTML = `
      <h2>Login</h2>
      <form id="loginForm">
        <label for="loginUsername">Username</label>
        <input type="text" id="loginUsername" required />
        <label for="loginPassword">Password</label>
        <input type="password" id="loginPassword" required />
        <button type="submit">Login</button>
        <p class="text-center">
          Don't have an account? <a href="#register">Register here</a>.
        </p>
      </form>
    `;
    $('#loginForm').onsubmit = (e) => {
      e.preventDefault();
      const username = $('#loginUsername').value.trim();
      const password = $('#loginPassword').value;
      const user = state.users.find(
        (u) => u.username.toLowerCase() === username.toLowerCase() && u.password === password
      );
      if (!user) {
        alert('Invalid username or password.');
        return;
      }
      state.currentUserId = user.id;
      saveState(state);
      window.location.hash = '#dashboard';
      render(state);
    };
  }

  /**
   * Render registration form for new users.
   */
  function renderRegister(container, state) {
    container.innerHTML = `
      <h2>Register</h2>
      <form id="registerForm">
        <label for="regUsername">Username</label>
        <input type="text" id="regUsername" required />
        <label for="regPassword">Password</label>
        <input type="password" id="regPassword" required />
        <label for="regRole">Role</label>
        <select id="regRole">
          <option value="dm">Dungeon Master (DM)</option>
          <option value="player">Player</option>
        </select>
        <button type="submit">Create Account</button>
        <p class="text-center">
          Already have an account? <a href="#login">Login here</a>.
        </p>
      </form>
    `;
    $('#registerForm').onsubmit = (e) => {
      e.preventDefault();
      const username = $('#regUsername').value.trim();
      const password = $('#regPassword').value;
      const role = $('#regRole').value;
      if (!username || !password) {
        alert('Please fill out all fields.');
        return;
      }
      if (state.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
        alert('Username already exists.');
        return;
      }
      const newUser = {
        id: uuid(),
        username,
        password,
        role,
      };
      state.users.push(newUser);
      state.currentUserId = newUser.id;
      saveState(state);
      window.location.hash = '#dashboard';
      render(state);
    };
  }

  /**
   * Render the dashboard: list of campaigns the current user belongs to.
   */
  function renderDashboard(container, state) {
    const user = state.users.find((u) => u.id === state.currentUserId);
    const campaigns = state.campaigns.filter(
      (c) => c.dmId === user.id || c.playerIds.includes(user.id)
    );
    let html = '<h2>Your Campaigns</h2>';
    if (campaigns.length === 0) {
      html += '<p>No campaigns yet. Create one to get started!</p>';
    } else {
      html += '<ul class="list">';
      campaigns.forEach((c) => {
        html += `<li>
          <span>${c.name}</span>
          <div class="actions">
            <button class="btn btn-secondary btn-small" data-id="${c.id}" data-action="open">Open</button>
            ${c.dmId === user.id ? `<button class="btn btn-danger btn-small" data-id="${c.id}" data-action="delete">Delete</button>` : ''}
          </div>
        </li>`;
      });
      html += '</ul>';
    }
    container.innerHTML = html;
    // Attach event handlers
    container.querySelectorAll('button[data-action="open"]').forEach((btn) => {
      btn.onclick = () => {
        window.location.hash = '#campaign';
        window.location.search = '?id=' + btn.dataset.id;
      };
    });
    container.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        if (confirm('Are you sure you want to delete this campaign?')) {
          // Remove campaign and associated sessions
          state.campaigns = state.campaigns.filter((c) => c.id !== id);
          state.sessions = state.sessions.filter((s) => s.campaignId !== id);
          saveState(state);
          render(state);
        }
      };
    });
  }

  /**
   * Render the new campaign creation form.
   */
  function renderCreateCampaign(container, state) {
    const user = state.users.find((u) => u.id === state.currentUserId);
    let html = `<h2>Create Campaign</h2>`;
    html += `
      <form id="createCampaignForm">
        <label for="campaignName">Campaign Name</label>
        <input type="text" id="campaignName" required />
        <label for="campaignDesc">Description</label>
        <textarea id="campaignDesc" rows="4"></textarea>
        <label for="campaignPlayers">Add Players (comma separated usernames)</label>
        <input type="text" id="campaignPlayers" placeholder="e.g. alice,bob" />
        <button type="submit">Create</button>
      </form>
    `;
    container.innerHTML = html;
    $('#createCampaignForm').onsubmit = (e) => {
      e.preventDefault();
      const name = $('#campaignName').value.trim();
      const desc = $('#campaignDesc').value.trim();
      const playersInput = $('#campaignPlayers').value.trim();
      if (!name) {
        alert('Campaign name is required');
        return;
      }
      const newCampaign = {
        id: uuid(),
        name,
        description: desc,
        dmId: user.id,
        playerIds: [],
        // Shared and private notes keyed by userId; shared is a single string
        notes: { shared: '', private: {} },
        // Chat messages; each message: { id, userId, text, timestamp }
        messages: [],
      };
      if (playersInput) {
        const usernames = playersInput.split(',').map((s) => s.trim()).filter(Boolean);
        usernames.forEach((uname) => {
          const u = state.users.find(
            (x) => x.username.toLowerCase() === uname.toLowerCase()
          );
          if (u) {
            newCampaign.playerIds.push(u.id);
          }
        });
      }
      state.campaigns.push(newCampaign);
      saveState(state);
      window.location.hash = '#dashboard';
      render(state);
    };
  }

  /**
   * Render details for a specific campaign. Allows proposing sessions and voting on times.
   */
  function renderCampaignDetail(container, state) {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const campaign = state.campaigns.find((c) => c.id === id);
    if (!campaign) {
      container.innerHTML = '<p>Campaign not found.</p>';
      return;
    }
    const user = state.users.find((u) => u.id === state.currentUserId);
    // Build header
    let html = `<h2>${campaign.name}</h2>`;
    html += `<p>${campaign.description || ''}</p>`;
    // Player list
    const players = campaign.playerIds
      .map((pid) => state.users.find((u) => u.id === pid))
      .filter(Boolean);
    html += `<p><strong>Dungeon Master:</strong> ${
      state.users.find((u) => u.id === campaign.dmId).username
    }</p>`;
    html += '<p><strong>Players:</strong> ' + (players.map((p) => p.username).join(', ') || 'None') + '</p>';
    // Add player input for DM
    if (campaign.dmId === user.id) {
      html += `
        <form id="addPlayerForm">
          <label for="addPlayerInput">Add Player (username)</label>
          <input type="text" id="addPlayerInput" />
          <button type="submit">Add Player</button>
        </form>
      `;
    }
    // Session proposal form (DM only)
    if (campaign.dmId === user.id) {
      html += `
        <form id="proposeSessionForm">
          <label for="sessionName">Session Title</label>
          <input type="text" id="sessionName" required />
          <label for="proposedDateTime">Propose Date & Time</label>
          <input type="datetime-local" id="proposedDateTime" />
          <button type="submit">Create Session</button>
        </form>
      `;
    }
    // List sessions for this campaign
    const sessions = state.sessions.filter((s) => s.campaignId === campaign.id);
    html += '<h3>Sessions</h3>';
    if (sessions.length === 0) {
      html += '<p>No sessions yet.</p>';
    } else {
      html += '<ul class="list">';
      sessions.forEach((s) => {
        html += `<li>
          <span>${s.name}</span>
          <div class="actions">
            <button class="btn btn-secondary btn-small" data-id="${s.id}" data-action="open-session">Open</button>
            ${campaign.dmId === user.id ? `<button class="btn btn-danger btn-small" data-id="${s.id}" data-action="delete-session">Delete</button>` : ''}
          </div>
        </li>`;
      });
      html += '</ul>';
    }
    // Notes section (shared and private)
    html += '<h3>Notes</h3>';
    html += `<label for="sharedNotes">Shared notes (visible to everyone)</label>`;
    html += `<textarea id="sharedNotes" rows="4" style="width:100%;">${
      campaign.notes.shared ? campaign.notes.shared.replace(/</g, '&lt;').replace(/>/g, '&gt;') : ''
    }</textarea>`;
    html += `<label for="privateNotes" style="margin-top:0.5rem;display:block;">Your private notes</label>`;
    html += `<textarea id="privateNotes" rows="4" style="width:100%;">${
      campaign.notes.private[user.id]
        ? campaign.notes.private[user.id].replace(/</g, '&lt;').replace(/>/g, '&gt;')
        : ''
    }</textarea>`;
    // Chat section
    html += '<h3>Chat</h3>';
    // List messages
    html += '<div id="chatMessages" style="max-height:200px;overflow-y:auto;border:1px solid #dee2e6;padding:0.5rem;">';
    campaign.messages
      .sort((a, b) => a.timestamp - b.timestamp)
      .forEach((msg) => {
        const sender = state.users.find((u) => u.id === msg.userId);
        const time = new Date(msg.timestamp).toLocaleTimeString();
        html += `<p><strong>${sender ? sender.username : 'Unknown'}:</strong> ${msg.text.replace(/</g, '&lt;').replace(/>/g, '&gt;')} <small style="color:#6c757d;">(${time})</small></p>`;
      });
    html += '</div>';
    // Chat form
    html += `<form id="chatForm" style="display:flex;margin-top:0.5rem;">
        <input type="text" id="chatInput" placeholder="Type a message..." style="flex:1;margin-right:0.5rem;" />
        <button type="submit" class="btn btn-primary btn-small">Send</button>
      </form>`;
    container.innerHTML = html;
    // Add event handlers
    const addPlayerForm = $('#addPlayerForm');
    if (addPlayerForm) {
      addPlayerForm.onsubmit = (e) => {
        e.preventDefault();
        const uname = $('#addPlayerInput').value.trim();
        const newPlayer = state.users.find(
          (u) => u.username.toLowerCase() === uname.toLowerCase()
        );
        if (!newPlayer) {
          alert('User not found');
          return;
        }
        if (campaign.playerIds.includes(newPlayer.id)) {
          alert('Player already in campaign');
          return;
        }
        campaign.playerIds.push(newPlayer.id);
        saveState(state);
        render(state);
      };
    }
    const proposeSessionForm = $('#proposeSessionForm');
    if (proposeSessionForm) {
      proposeSessionForm.onsubmit = (e) => {
        e.preventDefault();
        const title = $('#sessionName').value.trim();
        const datetimeInput = $('#proposedDateTime').value;
        if (!title) {
          alert('Session title is required');
          return;
        }
        const newSession = {
          id: uuid(),
          campaignId: campaign.id,
          name: title,
          proposedTimes: [],
          finalTimeId: null,
        };
        // If DM provided an initial time, add to proposed times
        if (datetimeInput) {
          newSession.proposedTimes.push({
            id: uuid(),
            datetime: datetimeInput,
            votes: [],
            createdBy: user.id,
          });
        }
        state.sessions.push(newSession);
        saveState(state);
        render(state);
      };
    }
    // Session actions
    container.querySelectorAll('button[data-action="open-session"]').forEach((btn) => {
      btn.onclick = () => {
        // Update the hash and query string; the hashchange listener will re-render
        window.location.search = '?id=' + btn.dataset.id;
        window.location.hash = '#session';
      };
    });

    container.querySelectorAll('button[data-action="delete-session"]').forEach((btn) => {
      btn.onclick = () => {
        if (confirm('Delete session?')) {
          state.sessions = state.sessions.filter((s) => s.id !== btn.dataset.id);
          saveState(state);
          render(state);
        }
      };
    });

    // Event handlers for notes and chat
    // Shared notes
    const sharedNotesEl = document.getElementById('sharedNotes');
    if (sharedNotesEl) {
      sharedNotesEl.onchange = () => {
        campaign.notes.shared = sharedNotesEl.value;
        saveState(state);
      };
    }
    // Private notes
    const privateNotesEl = document.getElementById('privateNotes');
    if (privateNotesEl) {
      privateNotesEl.onchange = () => {
        campaign.notes.private[user.id] = privateNotesEl.value;
        saveState(state);
      };
    }
    // Chat form
    const chatFormEl = document.getElementById('chatForm');
    if (chatFormEl) {
      chatFormEl.onsubmit = (e) => {
        e.preventDefault();
        const input = document.getElementById('chatInput');
        if (!input) return;
        const text = input.value.trim();
        if (!text) return;
        campaign.messages.push({
          id: uuid(),
          userId: user.id,
          text,
          timestamp: Date.now(),
        });
        input.value = '';
        saveState(state);
        updateChatMessages();
      };
    }
    function updateChatMessages() {
      const chatMessagesEl = document.getElementById('chatMessages');
      if (!chatMessagesEl) return;
      chatMessagesEl.innerHTML = '';
      campaign.messages
        .sort((a, b) => a.timestamp - b.timestamp)
        .forEach((msg) => {
          const sender = state.users.find((u) => u.id === msg.userId);
          const time = new Date(msg.timestamp).toLocaleTimeString();
          const p = document.createElement('p');
          p.innerHTML = `<strong>${sender ? sender.username : 'Unknown'}:</strong> ${msg.text.replace(/</g, '&lt;').replace(/>/g, '&gt;')} <small style="color:#6c757d;">(${time})</small>`;
          chatMessagesEl.appendChild(p);
        });
    }
  }

  /**
   * Render details for a specific session within a campaign. Users can vote on proposed times.
   */
  function renderSessionDetail(container, state) {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id');
    const session = state.sessions.find((s) => s.id === id);
    if (!session) {
      container.innerHTML = '<p>Session not found.</p>';
      return;
    }
    const campaign = state.campaigns.find((c) => c.id === session.campaignId);
    const user = state.users.find((u) => u.id === state.currentUserId);
    let html = `<h2>${session.name}</h2>`;
    html += `<p><strong>Campaign:</strong> ${campaign.name}</p>`;
    // Proposed times list
    html += '<h3>Proposed Times</h3>';
    if (session.proposedTimes.length === 0) {
      html += '<p>No times proposed yet.</p>';
    } else {
      // Sort times by votes and date
      const sortedTimes = [...session.proposedTimes].sort(compareProposedTimes);
      html += '<ul class="list">';
      sortedTimes.forEach((t) => {
        const voteCount = t.votes.length;
        const userHasVoted = t.votes.includes(user.id);
        html += `<li>
          <span>${formatDateTime(t.datetime)} — ${voteCount} vote${voteCount !== 1 ? 's' : ''}</span>
          <div class="actions">
            <button class="btn btn-${userHasVoted ? 'secondary' : 'primary'} btn-small" data-id="${t.id}" data-action="vote">
              ${userHasVoted ? 'Unvote' : 'Vote'}
            </button>
            ${campaign.dmId === user.id ? `<button class="btn btn-danger btn-small" data-id="${t.id}" data-action="delete-time">Delete</button>` : ''}
          </div>
        </li>`;
      });
      html += '</ul>';
      // Show winning time if exists
      if (session.finalTimeId) {
        const finalTime = session.proposedTimes.find((t) => t.id === session.finalTimeId);
        if (finalTime) {
          html += `<p><strong>Scheduled:</strong> ${formatDateTime(finalTime.datetime)}</p>`;
        }
      }
    }
    // DM can add new proposed time
    if (campaign.dmId === user.id) {
      html += `
        <form id="addTimeForm">
          <label for="newTime">Add Proposed Date & Time</label>
          <input type="datetime-local" id="newTime" />
          <button type="submit">Add Time</button>
        </form>
        <button id="finalizeBtn" class="btn btn-secondary" ${
          session.proposedTimes.length === 0 ? 'disabled' : ''
        }>Finalize Best Time</button>
      `;
    }
    // Back to campaign button
    html += `<p><a href="#campaign?id=${campaign.id}" class="btn btn-secondary">Back to Campaign</a></p>`;
    container.innerHTML = html;
    // Event handlers
    container.querySelectorAll('button[data-action="vote"]').forEach((btn) => {
      btn.onclick = () => {
        const timeId = btn.dataset.id;
        const t = session.proposedTimes.find((x) => x.id === timeId);
        if (!t) return;
        const index = t.votes.indexOf(user.id);
        if (index === -1) {
          t.votes.push(user.id);
        } else {
          t.votes.splice(index, 1);
        }
        saveState(state);
        renderSessionDetail(container, state);
      };
    });
    container.querySelectorAll('button[data-action="delete-time"]').forEach((btn) => {
      btn.onclick = () => {
        const timeId = btn.dataset.id;
        session.proposedTimes = session.proposedTimes.filter((t) => t.id !== timeId);
        if (session.finalTimeId === timeId) session.finalTimeId = null;
        saveState(state);
        renderSessionDetail(container, state);
      };
    });
    const addTimeForm = $('#addTimeForm');
    if (addTimeForm) {
      addTimeForm.onsubmit = (e) => {
        e.preventDefault();
        const newTime = $('#newTime').value;
        if (!newTime) {
          alert('Please pick a date and time');
          return;
        }
        session.proposedTimes.push({
          id: uuid(),
          datetime: newTime,
          votes: [],
          createdBy: user.id,
        });
        saveState(state);
        renderSessionDetail(container, state);
      };
    }
    const finalizeBtn = $('#finalizeBtn');
    if (finalizeBtn) {
      finalizeBtn.onclick = () => {
        if (session.proposedTimes.length === 0) return;
        // Determine best time: most votes, earliest date
        const best = session.proposedTimes.sort(compareProposedTimes)[0];
        session.finalTimeId = best.id;
        saveState(state);
        alert('Session scheduled for ' + formatDateTime(best.datetime));
        renderSessionDetail(container, state);
      };
    }

    // Dice roller section
    (function renderDiceRoller() {
      const diceSection = document.createElement('div');
      diceSection.innerHTML = '<h3>Dice Roller</h3>';
      const diceTypes = [4, 6, 8, 10, 12, 20, 100];
      const btnContainer = document.createElement('div');
      btnContainer.style.display = 'flex';
      btnContainer.style.flexWrap = 'wrap';
      btnContainer.style.gap = '0.5rem';
      diceTypes.forEach((sides) => {
        const btn = document.createElement('button');
        btn.className = 'btn btn-secondary btn-small';
        btn.textContent = `d${sides}`;
        btn.onclick = () => {
          const result = Math.floor(Math.random() * sides) + 1;
          // Display result below
          const resEl = document.createElement('p');
          resEl.innerHTML = `<strong>Roll d${sides}:</strong> ${result}`;
          diceSection.appendChild(resEl);
        };
        btnContainer.appendChild(btn);
      });
      diceSection.appendChild(btnContainer);
      container.appendChild(diceSection);
    })();
  }

  /**
   * Render a simple countdown timer. Users can set a duration and start the timer.
   */
  function renderTimer(container, state) {
    let html = `<h2>Session Timer</h2>`;
    html += `
      <form id="timerForm">
        <label for="timerMinutes">Minutes</label>
        <input type="number" id="timerMinutes" min="1" max="720" value="60" />
        <button type="submit">Start Timer</button>
      </form>
      <div id="timerDisplay" class="timer"></div>
      <button id="stopTimerBtn" class="btn btn-danger hidden">Stop Timer</button>
    `;
    container.innerHTML = html;
    let timerInterval = null;
    const timerDisplay = $('#timerDisplay');
    $('#timerForm').onsubmit = (e) => {
      e.preventDefault();
      const minutes = parseInt($('#timerMinutes').value, 10);
      if (isNaN(minutes) || minutes <= 0) {
        alert('Please enter a positive number of minutes.');
        return;
      }
      const end = Date.now() + minutes * 60 * 1000;
      $('#stopTimerBtn').classList.remove('hidden');
      updateDisplay();
      timerInterval = setInterval(updateDisplay, 1000);
      function updateDisplay() {
        const remaining = end - Date.now();
        if (remaining <= 0) {
          clearInterval(timerInterval);
          timerDisplay.textContent = 'Time\'s up!';
          $('#stopTimerBtn').classList.add('hidden');
          return;
        }
        const totalSeconds = Math.floor(remaining / 1000);
        const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
        const ss = String(totalSeconds % 60).padStart(2, '0');
        timerDisplay.textContent = `${mm}:${ss}`;
      }
    };
    $('#stopTimerBtn').onclick = () => {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
      timerDisplay.textContent = '';
      $('#stopTimerBtn').classList.add('hidden');
    };
  }

  /**
   * Logout handler. Clears current user and redirects to login page.
   */
  function handleLogout(state) {
    state.currentUserId = null;
    saveState(state);
    window.location.hash = '#login';
    render(state);
  }

  // Kick off application
  document.addEventListener('DOMContentLoaded', init);
})();