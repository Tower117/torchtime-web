/*
 * TorchTime application logic
 *
 * This file implements a simple single–page application for running
 * Dungeons & Dragons campaigns.  It provides login/registration,
 * campaign scheduling, a timer, and a flexible character creator and
 * sheet.  All data is persisted to localStorage, which means your
 * campaigns and characters will be remembered when you refresh the
 * page.  No backend is required.  The character sheet borrows its
 * layout from the official D&D 5e sheet and auto‑calculates ability
 * scores, proficiencies and experience levels based on API data and
 * user input.
 */

(() => {
  // ----- Utilities -----
  const $ = (selector) => document.querySelector(selector);

  /**
   * Load application state from localStorage.  If nothing is stored yet
   * return sensible defaults.
   */
  function loadState() {
    try {
      const raw = localStorage.getItem('torchtimeData');
      if (!raw) {
        // Initialise default state for a fresh install.  In addition to the
        // core collections we also include a `rolls` array for dice log
        // entries.  This ensures newer features such as the dice roller
        // function correctly without requiring migration.
        return {
          users: [],
          campaigns: [],
          sessions: [],
          proposals: [],
          characters: [],
          rolls: [],
          currentUserId: null,
        };
      }
      const parsed = JSON.parse(raw);
      // Ensure new keys exist when upgrading older saves
      if (!Array.isArray(parsed.characters)) parsed.characters = [];
      if (!Array.isArray(parsed.proposals)) parsed.proposals = [];
      // Upgrade existing saves: add rolls array if missing
      if (!Array.isArray(parsed.rolls)) parsed.rolls = [];
      return parsed;
    } catch (err) {
      console.error('Failed to parse state', err);
      return {
        users: [],
        campaigns: [],
        sessions: [],
        proposals: [],
        characters: [],
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
   * Generate a unique identifier.  In production you'd use a proper
   * database or UUID library.
   */
  function uuid() {
    return (
      Date.now().toString(36) +
      Math.random().toString(36).substring(2, 8)
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
   * Compute a D&D 5e level from experience points.  The thresholds
   * correspond to the official XP progression table up to level 20.
   * @param {number} xp
   * @returns {number}
   */
  function getLevelFromXp(xp) {
    const thresholds = [
      0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000,
      85000, 100000, 120000, 140000, 165000, 195000, 225000,
      265000, 305000, 355000,
    ];
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (xp >= thresholds[i]) return i + 1;
    }
    return 1;
  }

  /**
   * Fetch race traits from the D&D 5e API.  Returns an array of
   * trait names for the given race index.  Used when creating
   * characters and populating their features list.
   * @param {string} raceIndex
   * @returns {Promise<string[]>}
   */
  async function fetchRaceTraits(raceIndex) {
    try {
      const res = await fetch(`https://www.dnd5eapi.co/api/races/${raceIndex}`);
      const data = await res.json();
      if (!data.traits || data.traits.length === 0) return [];
      // Fetch trait details in parallel; if a trait fails we still continue
      const traitPromises = data.traits.map((t) =>
        fetch(`https://www.dnd5eapi.co${t.url}`)
          .then((resp) => resp.json())
          .then((trait) => trait.name)
          .catch(() => t.name)
      );
      const traitNames = await Promise.all(traitPromises);
      return traitNames;
    } catch (err) {
      console.error('Failed to fetch race traits', err);
      return [];
    }
  }

  /**
   * Fetch class features for a given class index and level.  Returns
   * an array of feature names.  This uses the D&D 5e API endpoint
   * /api/classes/{index}/levels/{level}.  If no features are found,
   * returns an empty array.
   * @param {string} classIndex
   * @param {number} level
   * @returns {Promise<string[]>}
   */
  async function fetchLevelFeatures(classIndex, level) {
    try {
      const res = await fetch(`https://www.dnd5eapi.co/api/classes/${classIndex}/levels/${level}`);
      const data = await res.json();
      if (!data.features || data.features.length === 0) return [];
      // Resolve feature names; the API returns objects with name and url
      const featurePromises = data.features.map((f) =>
        fetch(`https://www.dnd5eapi.co${f.url}`)
          .then((resp) => resp.json())
          .then((feat) => feat.name)
          .catch(() => f.name)
      );
      const featureNames = await Promise.all(featurePromises);
      return featureNames;
    } catch (err) {
      console.error('Failed to fetch level features', err);
      return [];
    }
  }

  /**
   * Prompt the user to apply an Ability Score Increase.  This helper
   * asks which ability scores to improve and updates the character's
   * abilityScores accordingly.  According to D&D rules, a typical
   * ability score improvement grants either +2 to a single ability or
   * +1 to two different abilities.  We implement a simple prompt
   * asking the user which abilities to increment.  The function
   * returns nothing but updates the passed character object.
   * @param {object} ch The character whose scores should be updated
   */
  async function promptAbilityScoreIncrease(ch) {
    try {
      const input = prompt(
        `${ch.name} gained an Ability Score Increase!\n` +
        `Enter one ability to increase by +2 or two abilities separated by comma to increase by +1 each.\n` +
        `Valid codes: STR, DEX, CON, INT, WIS, CHA.`
      );
      if (!input) return;
      const parts = input
        .split(/[,\s]+/)
        .map((p) => p.trim().toLowerCase())
        .filter((p) => ['str','dex','con','int','wis','cha'].includes(p));
      if (parts.length === 1) {
        ch.abilityScores[parts[0]] += 2;
      } else if (parts.length >= 2) {
        ch.abilityScores[parts[0]] += 1;
        ch.abilityScores[parts[1]] += 1;
      }
      // After ability score change, recompute hit points based on new CON modifier for subsequent levels
      return;
    } catch (err) {
      console.error('Error applying ability score increase', err);
    }
  }

  /**
   * Handle a player's vote on a session proposal option.  Ensures that
   * the user's ID is recorded in the selected vote type and removed
   * from other vote types for the same option.  The updated
   * proposal is persisted via saveState.
   * @param {object} proposal The proposal object
   * @param {number} optionIndex Index of the option being voted on
   * @param {string} voteType One of 'yes', 'maybe', 'no'
   * @param {object} state The application state
   */
  function handleVote(proposal, optionIndex, voteType, state) {
    const userId = state.currentUserId;
    if (!proposal.votes[optionIndex]) {
      proposal.votes[optionIndex] = { yes: [], maybe: [], no: [] };
    }
    // Remove user from all vote arrays
    ['yes', 'maybe', 'no'].forEach((vt) => {
      const idx = proposal.votes[optionIndex][vt].indexOf(userId);
      if (idx >= 0) proposal.votes[optionIndex][vt].splice(idx, 1);
    });
    // Add user to selected vote type array
    proposal.votes[optionIndex][voteType].push(userId);
    saveState(state);
  }

  /**
   * Setup background music.  Creates an AudioContext with a simple
   * lowpass filter to simulate the muffled ambience of a tavern and
   * hooks up the global music toggle.  Music preference is stored in
   * localStorage under the key "musicEnabled".
   */
  function setupAudio() {
    const audioEl = document.getElementById('bg-music');
    if (!audioEl) return;
    // Define available music tracks.  Additional files can be dropped
    // into the project directory and referenced here.  The keys are
    // user‑friendly names and the values are file names relative to
    // index.html.  The default track is tavern.
    const musicTracks = {
      tavern: 'tavern.wav',
      exploration: 'exploration.wav',
      dungeon: 'dungeon.wav',
    };
    // Apply previously selected track or default if none
    const savedTrack = localStorage.getItem('musicTrack') || 'tavern';
    if (musicTracks[savedTrack]) {
      audioEl.src = musicTracks[savedTrack];
    }
    // Create audio context on first user interaction to comply with
    // browser autoplay policies.  We'll connect the audio element to
    // a lowpass filter for a tavern vibe.
    let context;
    let source;
    let filter;
    function initContext() {
      if (context) return;
      context = new (window.AudioContext || window.webkitAudioContext)();
      source = context.createMediaElementSource(audioEl);
      filter = context.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 1200; // cut high frequencies
      source.connect(filter);
      filter.connect(context.destination);
    }
    // Read preference
    const pref = localStorage.getItem('musicEnabled');
    const musicEnabled = pref === null ? true : pref === 'true';
    if (musicEnabled) {
      // Ensure context will be created when playing
      audioEl.addEventListener('play', initContext, { once: true });
      // Autoplay may be blocked; we catch errors silently
      audioEl.play().catch(() => {});
    }
    // Expose control functions on the window so renderNav can create a toggle
    window.isMusicPlaying = () => !audioEl.paused;
    window.toggleMusic = () => {
      initContext();
      if (audioEl.paused) {
        audioEl.play().catch(() => {});
      } else {
        audioEl.pause();
      }
      localStorage.setItem('musicEnabled', !audioEl.paused);
    };
    // Load simple click sound effect for UI feedback.  We create
    // a detached Audio instance per play to allow overlapping clicks.
    const clickUrl = 'click.wav';
    window.playClick = () => {
      const clickAudio = new Audio(clickUrl);
      clickAudio.volume = 0.6;
      clickAudio.play().catch(() => {});
    };
    // Expose track change function.  Changing the track pauses
    // playback, swaps the source and resumes if enabled.  The
    // selected track name is stored in localStorage under
    // `musicTrack` so it persists across sessions.
    window.setMusicTrack = (name) => {
      if (!musicTracks[name]) return;
      const wasPlaying = !audioEl.paused;
      audioEl.pause();
      audioEl.src = musicTracks[name];
      localStorage.setItem('musicTrack', name);
      // reset the context on new source
      if (context) {
        source.disconnect();
        source = context.createMediaElementSource(audioEl);
        source.connect(filter);
      }
      audioEl.load();
      if (wasPlaying) {
        audioEl.play().catch(() => {});
      }
    };
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
    const links = [
      { href: '#dashboard', label: '🛡 Campaigns' },
      { href: '#create-campaign', label: '⚔️ New Campaign' },
      { href: '#timer', label: '📅 Schedule' },
      // Additional navigation entries for the item library and dice roller.
      { href: '#items', label: '📦 Items' },
      { href: '#dice', label: '🎲 Dice' },
      { href: '#character-creator', label: '🧙 Create Character' },
      { href: '#characters', label: '👤 My Characters' },
      { href: '#logout', label: '🚪 Logout' },
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
    // Append music toggle to the nav if audio is available
    if (typeof window.toggleMusic === 'function' && typeof window.isMusicPlaying === 'function') {
      const toggle = document.createElement('span');
      toggle.id = 'musicToggle';
      toggle.className = 'music-toggle';
      const playing = window.isMusicPlaying();
      const emoji = playing ? '🎵' : '🔇';
      toggle.textContent = `${emoji} ${playing ? 'Music On' : 'Music Off'}`;
      toggle.onclick = () => {
        window.toggleMusic();
        // re-render nav to update the toggle state
        renderNav(state);
      };
      nav.appendChild(toggle);
      // Music track selector: allows the user to switch between available
      // atmosphere tracks.  The select's value persists via setMusicTrack.
      if (typeof window.setMusicTrack === 'function') {
        const select = document.createElement('select');
        select.id = 'musicSelect';
        select.className = 'music-select';
        // Define options; the keys must match those in setupAudio
        const options = [
          { value: 'tavern', label: 'Tavern' },
          { value: 'exploration', label: 'Exploration' },
          { value: 'dungeon', label: 'Dungeon' },
        ];
        options.forEach((opt) => {
          const o = document.createElement('option');
          o.value = opt.value;
          o.textContent = opt.label;
          if (localStorage.getItem('musicTrack') === opt.value) {
            o.selected = true;
          }
          select.appendChild(o);
        });
        select.onchange = (e) => {
          window.setMusicTrack(e.target.value);
        };
        nav.appendChild(select);
      }
    }
  }

  /**
   * Entry point: called once on page load.
   */
  function init() {
    // Display current year in footer
    $('#year').textContent = new Date().getFullYear();
    // Load state from localStorage
    const state = loadState();
    // Setup audio and toggle
    setupAudio();
    // Setup hash change listener
    window.addEventListener('hashchange', () => {
      render(state);
    });
    // Initial render
    render(state);
    // Attach global click handler to play click sound on most button presses
    document.body.addEventListener('click', (evt) => {
      const target = evt.target;
      // Only trigger on real buttons or elements with class btn
      if (window.playClick && (target.tagName === 'BUTTON' || target.classList.contains('btn'))) {
        window.playClick();
      }
    });
  }

  /**
   * Main render function.  Decides which view to display based on the hash.
   * @param {object} state
   */
  function render(state) {
    renderNav(state);
    const app = $('#app');
    // Always strip any query parameters from the hash before routing. Without
    // this, hashes like "#campaign?id=..." would not match their case in the
    // switch below and the dashboard would incorrectly render. Split on '?'
    // to get the route prefix and use that for comparison.
    const fullHash = window.location.hash || '#dashboard';
    const route = fullHash.split('?')[0];
    // If the user is not authenticated, only allow login or register views.
    if (!state.currentUserId) {
      if (route === '#register') {
        renderRegister(app, state);
      } else {
        renderLogin(app, state);
      }
      return;
    }
    switch (route) {
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
      case '#items':
        renderItemLibrary(app, state);
        break;
      case '#dice':
        renderDiceRoller(app, state);
        break;
      case '#character-creator':
        renderCharacterCreator(app, state);
        break;
      case '#characters':
        renderCharacterList(app, state);
        break;
      case '#character-sheet':
        renderCharacterSheet(app, state);
        break;
      case '#logout':
        handleLogout(state);
        break;
      case '#propose-session':
        renderProposeSession(app, state);
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
        (u) =>
          u.username.toLowerCase() === username.toLowerCase() &&
          u.password === password
      );
      if (!user) {
        alert('Invalid username or password.');
        return;
      }
      state.currentUserId = user.id;
      saveState(state);
      window.location.hash = '#dashboard';
    };
  }

  /**
   * Render registration form.
   */
  function renderRegister(container, state) {
    container.innerHTML = `
      <h2>Register</h2>
      <form id="registerForm">
        <label for="registerUsername">Username</label>
        <input type="text" id="registerUsername" required />
        <label for="registerPassword">Password</label>
        <input type="password" id="registerPassword" required />
        <button type="submit">Register</button>
        <p class="text-center">
          Already have an account? <a href="#login">Login here</a>.
        </p>
      </form>
    `;
    $('#registerForm').onsubmit = (e) => {
      e.preventDefault();
      const username = $('#registerUsername').value.trim();
      const password = $('#registerPassword').value;
      if (!username || !password) {
        alert('Please enter a username and password.');
        return;
      }
      if (state.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) {
        alert('Username already exists.');
        return;
      }
      const user = {
        id: uuid(),
        username,
        password,
      };
      state.users.push(user);
      state.currentUserId = user.id;
      saveState(state);
      window.location.hash = '#dashboard';
    };
  }

  /**
   * Render the dashboard showing a list of campaigns.
   */
  function renderDashboard(container, state) {
    const user = state.users.find((u) => u.id === state.currentUserId);
    container.innerHTML = `<h2>Campaigns</h2>`;
    const list = document.createElement('ul');
    list.className = 'list';
    state.campaigns.forEach((camp) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${camp.name}</span>`;
      const actions = document.createElement('div');
      actions.className = 'actions';
      const openBtn = document.createElement('button');
      openBtn.className = 'btn btn-primary btn-small';
      openBtn.textContent = 'Open';
      openBtn.onclick = () => {
        location.hash = `#campaign?id=${camp.id}`;
      };
      actions.appendChild(openBtn);
      li.appendChild(actions);
      list.appendChild(li);
    });
    container.appendChild(list);
    if (state.campaigns.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'No campaigns created yet.';
      container.appendChild(p);
    }
  }

  /**
   * Render the create campaign form.
   */
  function renderCreateCampaign(container, state) {
    container.innerHTML = `
      <h2>New Campaign</h2>
      <form id="createCampaignForm">
        <label for="campName">Campaign Name</label>
        <input type="text" id="campName" required />
        <button type="submit">Create Campaign</button>
      </form>
    `;
    $('#createCampaignForm').onsubmit = (e) => {
      e.preventDefault();
      const name = $('#campName').value.trim();
      if (!name) {
        alert('Please enter a campaign name');
        return;
      }
      state.campaigns.push({ id: uuid(), name, ownerId: state.currentUserId });
      saveState(state);
      window.location.hash = '#dashboard';
    };
  }

  /**
   * Render details for a specific campaign including sessions and
   * characters.  The current campaign id is taken from the URL hash.
   */
  function renderCampaignDetail(container, state) {
    const params = new URLSearchParams(window.location.hash.split('?')[1]);
    const id = params.get('id');
    const campaign = state.campaigns.find((c) => c.id === id);
    if (!campaign) {
      container.innerHTML = '<p>Campaign not found.</p>';
      return;
    }
    // Track which campaign is currently being viewed for logging dice rolls
    state.currentCampaignId = campaign.id;
    container.innerHTML = `<h2>${campaign.name}</h2>`;
    // Scheduled sessions listing (finalised)
    const schedHeader = document.createElement('h3');
    schedHeader.textContent = 'Scheduled Sessions';
    container.appendChild(schedHeader);
    const schedList = document.createElement('ul');
    schedList.className = 'list';
    // A session can be represented either in state.sessions or as a finalised proposal
    // Gather finalised proposals as sessions
    const finalisedProposals = state.proposals.filter((p) => p.campaignId === campaign.id && p.finalized);
    const scheduledSessions = [];
    // Build a set of keys for finalised proposals so we can avoid duplicates.
    const finalizedKeys = new Set();
    finalisedProposals.forEach((p) => {
      const opt = p.options[p.finalChoiceIndex];
      const dateStr = `${opt.date}T${opt.start}`;
      const key = `${dateStr}|${opt.end}|${opt.location || ''}`;
      finalizedKeys.add(key);
      scheduledSessions.push({
        id: p.id, // reuse proposal id
        datetime: new Date(dateStr),
        campaignId: campaign.id,
        end: opt.end,
        location: opt.location,
      });
    });
    // Include legacy sessions from state.sessions only if they don't duplicate
    // an already scheduled session (either a finalised proposal or an earlier
    // session).  Two sessions are considered duplicates if their start time
    // (to the minute) and location match.
    state.sessions
      .filter((s) => s.campaignId === campaign.id)
      .forEach((s) => {
        const sStart = new Date(s.datetime);
        // Determine if this session already exists in scheduledSessions
        const duplicate = scheduledSessions.some((existing) => {
          const eStart = new Date(existing.datetime);
          return (
            eStart.getFullYear() === sStart.getFullYear() &&
            eStart.getMonth() === sStart.getMonth() &&
            eStart.getDate() === sStart.getDate() &&
            eStart.getHours() === sStart.getHours() &&
            eStart.getMinutes() === sStart.getMinutes() &&
            (existing.location || '') === (s.location || '')
          );
        });
        if (!duplicate) {
          scheduledSessions.push(s);
        }
      });
    scheduledSessions
      .sort((a, b) => new Date(a.datetime) - new Date(b.datetime))
      .forEach((sess) => {
        const li = document.createElement('li');
        const dateStr = sess.datetime ? formatDateTime(sess.datetime) : '';
        const locStr = sess.location ? ` @ ${sess.location}` : '';
        li.innerHTML = `<span>${dateStr}${locStr}</span>`;
        const actions = document.createElement('div');
        actions.className = 'actions';
        const openBtn = document.createElement('button');
        openBtn.className = 'btn btn-primary btn-small';
        openBtn.textContent = 'View';
        openBtn.onclick = () => {
          // Use the existing session viewer
          window.location.hash = `#session?id=${sess.id}`;
        };
        actions.appendChild(openBtn);
        li.appendChild(actions);
        schedList.appendChild(li);
      });
    container.appendChild(schedList);
    // Proposed sessions listing (not yet finalised)
    const propHeader = document.createElement('h3');
    propHeader.textContent = 'Proposed Sessions';
    container.appendChild(propHeader);
    const propList = document.createElement('div');
    // Show each proposal with its options and finalize controls
    state.proposals
      .filter((p) => p.campaignId === campaign.id && !p.finalized)
      .forEach((proposal) => {
        const div = document.createElement('div');
        div.style.border = '1px solid #dee2e6';
        div.style.borderRadius = '4px';
        div.style.padding = '0.5rem';
        div.style.marginBottom = '0.5rem';
        div.innerHTML = `<p><strong>Proposal #${proposal.id.substring(0, 6)}</strong></p>`;
        // Build a table of options
        const table = document.createElement('table');
        table.style.width = '100%';
        table.style.borderCollapse = 'collapse';
        const headerRow = document.createElement('tr');
        headerRow.innerHTML = '<th>Option</th><th>Votes (Yes/Maybe/No)</th><th>Actions</th>';
        table.appendChild(headerRow);
          proposal.options.forEach((opt, idx) => {
            const row = document.createElement('tr');
            const votes = proposal.votes[idx] || { yes: [], maybe: [], no: [] };
            const voteCounts = `${votes.yes.length}/${votes.maybe.length}/${votes.no.length}`;
            row.innerHTML = `
              <td>${opt.date} ${opt.start}-${opt.end}${opt.location ? ' @ ' + opt.location : ''}</td>
              <td style="text-align:center;">${voteCounts}</td>
              <td style="text-align:right;"></td>
            `;
            const actionsDiv = row.lastElementChild;
            if (campaign.ownerId === state.currentUserId) {
              // DM can finalize
              const finalBtn = document.createElement('button');
              finalBtn.className = 'btn btn-primary btn-small';
              finalBtn.textContent = 'Finalize';
              finalBtn.onclick = () => {
                // Mark this proposal as finalised and record which option was chosen.
                proposal.finalized = true;
                proposal.finalChoiceIndex = idx;
                // Do not push an additional session into state.sessions.  Finalised
                // proposals are treated as sessions in renderCampaignDetail.
                saveState(state);
                alert('Session finalized!');
                renderCampaignDetail(container, state);
              };
              actionsDiv.appendChild(finalBtn);
            } else {
              // Player voting controls: Yes, Maybe, No
              const voteTypes = ['yes', 'maybe', 'no'];
              voteTypes.forEach((vt) => {
                const btn = document.createElement('button');
                btn.className = 'btn btn-secondary btn-small';
                btn.textContent = vt.charAt(0).toUpperCase() + vt.slice(1);
                // Highlight selected vote
                if (proposal.votes[idx] && proposal.votes[idx][vt].includes(state.currentUserId)) {
                  btn.classList.add('active');
                }
                btn.onclick = () => {
                  handleVote(proposal, idx, vt, state);
                  renderCampaignDetail(container, state);
                };
                actionsDiv.appendChild(btn);
              });
            }
            row.appendChild(actionsDiv);
            table.appendChild(row);
          });
        div.appendChild(table);
        propList.appendChild(div);
      });
    container.appendChild(propList);
    // Propose new session button
    const proposeBtn = document.createElement('button');
    proposeBtn.className = 'btn btn-primary';
    proposeBtn.textContent = 'Propose New Session';
    proposeBtn.onclick = () => {
      window.location.hash = `#propose-session?campaignId=${campaign.id}`;
    };
    container.appendChild(proposeBtn);
    // Characters listing
    const charHeader = document.createElement('h3');
    charHeader.textContent = 'Characters';
    container.appendChild(charHeader);
    const charList = document.createElement('ul');
    charList.className = 'list';
    state.characters
      .filter((ch) => ch.campaignId === campaign.id)
      .forEach((ch) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${ch.name} (Lvl ${ch.level})</span>`;
        const actions = document.createElement('div');
        actions.className = 'actions';
        const sheetBtn = document.createElement('button');
        sheetBtn.className = 'btn btn-primary btn-small';
        sheetBtn.textContent = 'View';
        sheetBtn.onclick = () => {
          window.location.hash = `#character-sheet?id=${ch.id}`;
        };
        actions.appendChild(sheetBtn);
        // If current user is campaign owner, allow awarding XP
        if (campaign.ownerId === state.currentUserId) {
          const xpBtn = document.createElement('button');
          xpBtn.className = 'btn btn-secondary btn-small';
          xpBtn.textContent = 'Award XP';
          xpBtn.onclick = async () => {
            const xpStr = prompt('XP to award to this character:');
            const xp = parseInt(xpStr, 10);
            if (isNaN(xp) || xp <= 0) return;
            ch.xp += xp;
            // Determine new level after awarding XP
            const newLevel = getLevelFromXp(ch.xp);
            if (newLevel > ch.level) {
              alert(`${ch.name} levelled up to level ${newLevel}!`);
              // Handle leveling up: update level, HP and features for each level gained
              for (let lvl = ch.level + 1; lvl <= newLevel; lvl++) {
                // Increase hit points by hit die + CON mod
                const conMod = Math.floor((ch.abilityScores.con - 10) / 2);
                ch.hp += (ch.hitDie || 8) + conMod;
                // Fetch and add features for this level
                if (ch.classIndex) {
                  const feats = await fetchLevelFeatures(ch.classIndex, lvl);
                  const existing = new Set(ch.features || []);
                  feats.forEach((f) => existing.add(f));
                  ch.features = Array.from(existing);
                  // If ability score improvement available, prompt player
                  const asiFeat = feats.find((f) => /ability score/i.test(f));
                  if (asiFeat) {
                    await promptAbilityScoreIncrease(ch);
                  }
                }
              }
              ch.level = newLevel;
            }
            saveState(state);
            renderCampaignDetail(container, state);
          };
          actions.appendChild(xpBtn);
        }
        li.appendChild(actions);
        charList.appendChild(li);
      });
    container.appendChild(charList);

    // Show recent dice rolls for this campaign.  Players and the DM can
    // refer to this log to see the outcomes of ability checks or attack
    // rolls.  We create a heading and a container, then delegate
    // rendering to renderRollLog.  If no rolls exist yet the log will
    // simply be empty.
    const rollHeader = document.createElement('h3');
    rollHeader.textContent = 'Recent Rolls';
    container.appendChild(rollHeader);
    const rollDiv = document.createElement('div');
    container.appendChild(rollDiv);
    renderRollLog(rollDiv, state, campaign.id);
  }

  /**
   * Render details for a specific session.  Currently just shows the date
   * and time with a back link.  In a full implementation you could add
   * voting on times, notes, etc.
   */
  function renderSessionDetail(container, state) {
    const params = new URLSearchParams(window.location.hash.split('?')[1]);
    const id = params.get('id');
    const session = state.sessions.find((s) => s.id === id);
    if (!session) {
      container.innerHTML = '<p>Session not found.</p>';
      return;
    }
    container.innerHTML = `<h2>Session</h2><p>${formatDateTime(session.datetime)}</p>`;
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-secondary';
    backBtn.textContent = 'Back to Campaign';
    backBtn.onclick = () => {
      window.history.back();
    };
    container.appendChild(backBtn);
  }

  /**
   * Simple timer/stopwatch page.  Useful for keeping track of turns.
   */
  function renderTimer(container, state) {
    container.innerHTML = `<h2>Timer</h2>
      <p class="timer" id="timerDisplay">00:00:00</p>
      <button class="btn btn-primary" id="startTimer">Start</button>
      <button class="btn btn-secondary" id="stopTimer">Stop</button>
      <button class="btn btn-danger" id="resetTimer">Reset</button>`;
    let intervalId = null;
    let startTime;
    function updateDisplay() {
      const elapsed = Date.now() - startTime;
      const hrs = String(Math.floor(elapsed / 3600000)).padStart(2, '0');
      const mins = String(Math.floor((elapsed % 3600000) / 60000)).padStart(2, '0');
      const secs = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
      $('#timerDisplay').textContent = `${hrs}:${mins}:${secs}`;
    }
    $('#startTimer').onclick = () => {
      if (intervalId) return;
      startTime = Date.now();
      intervalId = setInterval(updateDisplay, 1000);
    };
    $('#stopTimer').onclick = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    $('#resetTimer').onclick = () => {
      clearInterval(intervalId);
      intervalId = null;
      $('#timerDisplay').textContent = '00:00:00';
    };
  }

  /**
   * Render the character creation wizard.  This step–by–step form
   * collects basic information and pulls race/class data from the
   * external D&D 5e API.  Stats are auto‑calculated with racial
   * bonuses and default to the standard array.
   */
  function renderCharacterCreator(container, state) {
    container.innerHTML = `<h2>Create Character</h2>
      <div id="creatorStep"></div>`;
    // Character object under construction
    const charDraft = {
      id: uuid(),
      userId: state.currentUserId,
      campaignId: null,
      name: '',
      gender: '',
      race: null,
      raceIndex: null,
      class: null,
      classIndex: null,
      subclass: null,
      subclassIndex: null,
      level: 1,
      xp: 0,
      abilityScores: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
      proficiencies: [],
      features: [],
      hitDie: null,
      hp: null,
    };
    // Step tracker
    let step = 0;
    function nextStep() {
      step++;
      renderStep();
    }
    function prevStep() {
      step--;
      renderStep();
    }
    function renderStep() {
      const wrap = $('#creatorStep');
      wrap.innerHTML = '';
      const navDiv = document.createElement('div');
      navDiv.style.marginBottom = '1rem';
      if (step > 0) {
        const backBtn = document.createElement('button');
        backBtn.className = 'btn btn-secondary';
        backBtn.textContent = 'Back';
        backBtn.onclick = prevStep;
        navDiv.appendChild(backBtn);
      }
      wrap.appendChild(navDiv);
      switch (step) {
        case 0:
          // Step 1: Name and gender
          wrap.innerHTML += `
            <form id="step1">
              <label for="charName">Character Name</label>
              <input type="text" id="charName" value="${charDraft.name}" required />
              <label for="charGender">Gender</label>
              <input type="text" id="charGender" value="${charDraft.gender}" />
              <button type="submit">Next</button>
            </form>
          `;
          $('#step1').onsubmit = (e) => {
            e.preventDefault();
            charDraft.name = $('#charName').value.trim();
            charDraft.gender = $('#charGender').value.trim();
            nextStep();
          };
          break;
        case 1:
          // Step 2: Race selection
          wrap.innerHTML += `<p><strong>Select a Race</strong></p>
            <select id="raceSelect"><option value="">Loading races...</option></select>
            <div id="raceInfo" style="margin-top:1rem;"></div>
            <button class="btn btn-primary" id="raceNext" disabled>Next</button>
          `;
          const raceSelect = document.getElementById('raceSelect');
          const raceInfo = document.getElementById('raceInfo');
          fetch('https://www.dnd5eapi.co/api/races')
            .then((res) => res.json())
            .then((data) => {
              raceSelect.innerHTML = '<option value="">-- Choose a race --</option>';
              data.results.forEach((race) => {
                const opt = document.createElement('option');
                opt.value = race.index;
                opt.textContent = race.name;
                raceSelect.appendChild(opt);
              });
            })
            .catch(() => {
              raceSelect.innerHTML = '<option>Error loading races</option>';
            });
          raceSelect.onchange = () => {
            const val = raceSelect.value;
            if (!val) {
              raceInfo.textContent = '';
              $('#raceNext').disabled = true;
              return;
            }
            raceInfo.textContent = 'Loading...';
            fetch(`https://www.dnd5eapi.co/api/races/${val}`)
              .then((res) => res.json())
              .then((data) => {
                charDraft.race = data;
                charDraft.raceIndex = data.index;
                // Apply ability bonuses to the standard array
                const base = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 };
                data.ability_bonuses.forEach((b) => {
                  const key = b.ability_score.name.substring(0, 3).toLowerCase();
                  base[key] += b.bonus;
                });
                charDraft.abilityScores = base;
                let html = `<h3>${data.name}</h3>`;
                html += `<p><strong>Speed:</strong> ${data.speed}</p>`;
                html += `<p><strong>Size:</strong> ${data.size}</p>`;
                html += `<p><strong>Alignment:</strong> ${data.alignment}</p>`;
                if (data.ability_bonuses && data.ability_bonuses.length > 0) {
                  html += '<p><strong>Ability Bonuses:</strong> ' +
                    data.ability_bonuses
                      .map((b) => `${b.ability_score.name} +${b.bonus}`)
                      .join(', ') +
                    '</p>';
                }
                if (data.traits && data.traits.length > 0) {
                  html += '<p><strong>Traits:</strong> ' +
                    data.traits.map((t) => t.name).join(', ') +
                    '</p>';
                }
                raceInfo.innerHTML = html;
                $('#raceNext').disabled = false;
              })
              .catch(() => {
                raceInfo.textContent = 'Error loading race details';
              });
          };
          $('#raceNext').onclick = () => {
            nextStep();
          };
          break;
        case 2:
          // Step 3: Class selection and subclass
          wrap.innerHTML += `<p><strong>Select a Class</strong></p>
            <select id="classSelect"><option value="">Loading classes...</option></select>
            <div id="classInfo" style="margin-top:1rem;"></div>
            <button class="btn btn-primary" id="classNext" disabled>Next</button>
          `;
          const classSelect = document.getElementById('classSelect');
          const classInfo = document.getElementById('classInfo');
          fetch('https://www.dnd5eapi.co/api/classes')
            .then((res) => res.json())
            .then((data) => {
              classSelect.innerHTML = '<option value="">-- Choose a class --</option>';
              data.results.forEach((cls) => {
                const opt = document.createElement('option');
                opt.value = cls.index;
                opt.textContent = cls.name;
                classSelect.appendChild(opt);
              });
            })
            .catch(() => {
              classSelect.innerHTML = '<option>Error loading classes</option>';
            });
          classSelect.onchange = () => {
            const val = classSelect.value;
            if (!val) {
              classInfo.textContent = '';
              $('#classNext').disabled = true;
              return;
            }
            classInfo.textContent = 'Loading...';
            fetch(`https://www.dnd5eapi.co/api/classes/${val}`)
              .then((res) => res.json())
              .then((data) => {
                charDraft.class = data;
                charDraft.classIndex = data.index;
                charDraft.hitDie = data.hit_die;
                let html = `<h3>${data.name}</h3>`;
                html += `<p><strong>Hit Die:</strong> d${data.hit_die}</p>`;
                html += `<p><strong>Proficiencies:</strong> `;
                if (data.proficiencies && data.proficiencies.length > 0) {
                  html += data.proficiencies.map((p) => p.name).join(', ');
                } else {
                  html += 'None';
                }
                html += '</p>';
                // Fetch subclasses to allow selection if present
                if (data.subclasses && data.subclasses.length > 0) {
                  html += '<p><strong>Subclass:</strong> <select id="subclassSelect"><option value="">-- Choose a subclass --</option>';
                  data.subclasses.forEach((sc) => {
                    html += `<option value="${sc.index}">${sc.name}</option>`;
                  });
                  html += '</select></p>';
                }
                classInfo.innerHTML = html;
                const subclassSelect = document.getElementById('subclassSelect');
                if (subclassSelect) {
                  subclassSelect.onchange = () => {
                    const scIndex = subclassSelect.value;
                    if (!scIndex) return;
                    fetch(`https://www.dnd5eapi.co/api/subclasses/${scIndex}`)
                      .then((res) => res.json())
                      .then((scData) => {
                        charDraft.subclass = scData;
                        charDraft.subclassIndex = scData.index;
                      });
                  };
                }
                $('#classNext').disabled = false;
              })
              .catch(() => {
                classInfo.textContent = 'Error loading class details';
              });
          };
          $('#classNext').onclick = () => {
            nextStep();
          };
          break;
        case 3:
          // Step 4: Ability scores (manual edit)
          wrap.innerHTML += `<p><strong>Ability Scores</strong></p>
            <div class="stats-grid">
              ${['str','dex','con','int','wis','cha'].map((k) => {
                const label = k.toUpperCase();
                const val = charDraft.abilityScores[k];
                return `<div class="stat"><label>${label}<br/><input type="number" id="${k}Score" value="${val}" min="1" max="30" /></label></div>`;
              }).join('')}
            </div>
            <button class="btn btn-primary" id="abilityNext">Next</button>
          `;
          $('#abilityNext').onclick = () => {
            ['str','dex','con','int','wis','cha'].forEach((k) => {
              const val = parseInt(document.getElementById(`${k}Score`).value, 10);
              charDraft.abilityScores[k] = isNaN(val) ? 10 : val;
            });
            nextStep();
          };
          break;
        case 4:
          // Step 5: Review & save
          // Calculate hit points: hit die + con mod at level 1
          const conMod = Math.floor((charDraft.abilityScores.con - 10) / 2);
          charDraft.hp = charDraft.hitDie + conMod;
          wrap.innerHTML += `<h3>Review Character</h3>
            <p><strong>Name:</strong> ${charDraft.name}</p>
            <p><strong>Gender:</strong> ${charDraft.gender || '—'}</p>
            <p><strong>Race:</strong> ${charDraft.race ? charDraft.race.name : ''}</p>
            <p><strong>Class:</strong> ${charDraft.class ? charDraft.class.name : ''}${charDraft.subclass ? ' / ' + charDraft.subclass.name : ''}</p>
            <p><strong>Level:</strong> ${charDraft.level}</p>
            <div class="stats-grid">
              ${['str','dex','con','int','wis','cha'].map((k) => {
                const label = k.toUpperCase();
                const val = charDraft.abilityScores[k];
                const mod = Math.floor((val - 10) / 2);
                return `<div class="stat"><span>${val}</span>${label}<br/>Mod: ${mod >= 0 ? '+'+mod : mod}</div>`;
              }).join('')}
            </div>
            <p><strong>Hit Points:</strong> ${charDraft.hp}</p>
            <button class="btn btn-primary" id="saveChar">Save Character</button>
          `;
          // Save button handler: asynchronously gather race traits and class features before storing
          $('#saveChar').onclick = async () => {
            // Ask which campaign to assign to (optional)
            let campChoice = null;
            if (state.campaigns.length > 0) {
              const sel = prompt('Enter campaign ID to assign this character, or leave blank for none.\nAvailable IDs:\n' + state.campaigns.map((c) => `${c.id}: ${c.name}`).join('\n'));
              campChoice = sel;
            }
            if (campChoice && state.campaigns.some((c) => c.id === campChoice)) {
              charDraft.campaignId = campChoice;
            }
            // Gather race traits and level 1 features
            const traits = charDraft.raceIndex ? await fetchRaceTraits(charDraft.raceIndex) : [];
            const lvlFeatures = charDraft.classIndex ? await fetchLevelFeatures(charDraft.classIndex, 1) : [];
            // Combine unique features
            const featuresSet = new Set([...traits, ...lvlFeatures]);
            charDraft.features = Array.from(featuresSet);
            // Push final object to state
            state.characters.push({
              id: charDraft.id,
              userId: charDraft.userId,
              campaignId: charDraft.campaignId,
              name: charDraft.name,
              gender: charDraft.gender,
              race: charDraft.race ? charDraft.race.name : '',
              raceIndex: charDraft.raceIndex,
              class: charDraft.class ? charDraft.class.name : '',
              classIndex: charDraft.classIndex,
              subclass: charDraft.subclass ? charDraft.subclass.name : '',
              subclassIndex: charDraft.subclassIndex,
              level: charDraft.level,
              xp: charDraft.xp,
              abilityScores: charDraft.abilityScores,
              hp: charDraft.hp,
              hitDie: charDraft.hitDie,
              features: charDraft.features,
              // Start characters with an empty inventory so item management can add to it
              inventory: [],
            });
            saveState(state);
            alert('Character saved!');
            window.location.hash = '#characters';
          };
          break;
        default:
          step = 0;
          renderStep();
          break;
      }
    }
    renderStep();
  }

  /**
   * Render a list of the current user's characters.  Allows opening
   * individual character sheets.
   */
  function renderCharacterList(container, state) {
    container.innerHTML = '<h2>My Characters</h2>';
    const list = document.createElement('ul');
    list.className = 'list';
    state.characters
      .filter((c) => c.userId === state.currentUserId)
      .forEach((ch) => {
        const li = document.createElement('li');
        li.innerHTML = `<span>${ch.name} (Lvl ${ch.level})</span>`;
        const actions = document.createElement('div');
        actions.className = 'actions';
        const viewBtn = document.createElement('button');
        viewBtn.className = 'btn btn-primary btn-small';
        viewBtn.textContent = 'View Sheet';
        viewBtn.onclick = () => {
          location.hash = `#character-sheet?id=${ch.id}`;
        };
        actions.appendChild(viewBtn);
        li.appendChild(actions);
        list.appendChild(li);
      });
    container.appendChild(list);
    if (list.children.length === 0) {
      const p = document.createElement('p');
      p.textContent = 'You have no characters yet.';
      container.appendChild(p);
    }
  }

  /**
   * Render a single character sheet.  The character id is passed via
   * the hash (e.g. #character-sheet?id=abcd).  Displays ability
   * scores, modifiers, hit points, level and XP.  If the viewer is the
   * DM (campaign owner) they can award XP from here.
   */
  function renderCharacterSheet(container, state) {
    const params = new URLSearchParams(window.location.hash.split('?')[1]);
    const id = params.get('id');
    const ch = state.characters.find((c) => c.id === id);
    if (!ch) {
      container.innerHTML = '<p>Character not found.</p>';
      return;
    }
    container.innerHTML = `<h2>${ch.name}</h2>`;
    const sheet = document.createElement('div');
    sheet.className = 'character-sheet';
    // Basic info
    sheet.innerHTML = `
      <p><strong>Level:</strong> ${ch.level} (XP: ${ch.xp})</p>
      <p><strong>Race / Class:</strong> ${ch.race} / ${ch.class}${ch.subclass ? ' (' + ch.subclass + ')' : ''}</p>
      <p><strong>Hit Points:</strong> ${ch.hp}</p>
      <div class="stats-grid">
        ${['str','dex','con','int','wis','cha'].map((k) => {
          const label = k.toUpperCase();
          const val = ch.abilityScores[k];
          const mod = Math.floor((val - 10) / 2);
          return `<div class="stat"><span>${val}</span>${label}<br/>Mod: ${mod >= 0 ? '+'+mod : mod}</div>`;
        }).join('')}
      </div>
      <p><strong>Features:</strong> ${ch.features && ch.features.length > 0 ? '<ul>' + ch.features.map(f => `<li>${f}</li>`).join('') + '</ul>' : 'None'}</p>
    `;
    container.appendChild(sheet);
    // After rendering the base sheet, replace the stats grid with rollable stats
    const statsGrid = sheet.querySelector('.stats-grid');
    if (statsGrid) {
      statsGrid.innerHTML = '';
      ['str','dex','con','int','wis','cha'].forEach((k) => {
        const label = k.toUpperCase();
        const val = ch.abilityScores[k];
        const mod = Math.floor((val - 10) / 2);
        const statDiv = document.createElement('div');
        statDiv.className = 'stat';
        statDiv.innerHTML = `<span>${val}</span>${label}<br/>Mod: ${mod >= 0 ? '+'+mod : mod}`;
        // Create roll button for this ability
        const rollBtn = document.createElement('button');
        rollBtn.className = 'btn btn-small';
        rollBtn.style.marginLeft = '0.25rem';
        rollBtn.textContent = '🎲';
        rollBtn.title = `Roll ${label} Check`;
        rollBtn.onclick = () => {
          // Roll 1d20 plus the ability modifier
          rollDice(`1d20${mod >= 0 ? '+' + mod : mod}`, `${ch.name} ${label} Check`, state);
          // Inform user to view log
          alert('Roll executed! Check the log in your campaign for results.');
        };
        statDiv.appendChild(rollBtn);
        statsGrid.appendChild(statDiv);
      });
    }
    // Inventory display
    const invTitle = document.createElement('p');
    invTitle.innerHTML = '<strong>Inventory:</strong>';
    sheet.appendChild(invTitle);
    if (!Array.isArray(ch.inventory) || ch.inventory.length === 0) {
      const none = document.createElement('p');
      none.textContent = 'None';
      sheet.appendChild(none);
    } else {
      const invList = document.createElement('ul');
      ch.inventory.forEach((item, idx) => {
        const li = document.createElement('li');
        li.innerHTML = `${item.name}`;
        const rem = document.createElement('button');
        rem.className = 'btn btn-small';
        rem.style.marginLeft = '0.5rem';
        rem.textContent = 'Remove';
        rem.onclick = () => {
          if (confirm(`Remove ${item.name} from inventory?`)) {
            ch.inventory.splice(idx, 1);
            saveState(state);
            renderCharacterSheet(container, state);
          }
        };
        li.appendChild(rem);
        invList.appendChild(li);
      });
      sheet.appendChild(invList);
    }
    // Determine if current user can award XP
    if (ch.campaignId) {
      const camp = state.campaigns.find((c) => c.id === ch.campaignId);
      if (camp && camp.ownerId === state.currentUserId) {
        const xpBtn = document.createElement('button');
        xpBtn.className = 'btn btn-secondary';
        xpBtn.textContent = 'Award XP';
        xpBtn.onclick = async () => {
          const xpStr = prompt('XP to award:');
          const xp = parseInt(xpStr, 10);
          if (isNaN(xp) || xp <= 0) return;
          ch.xp += xp;
          const newLevel = getLevelFromXp(ch.xp);
          if (newLevel > ch.level) {
            alert(`${ch.name} levelled up to level ${newLevel}!`);
            // Handle level ups sequentially
            for (let lvl = ch.level + 1; lvl <= newLevel; lvl++) {
              const conMod2 = Math.floor((ch.abilityScores.con - 10) / 2);
              ch.hp += (ch.hitDie || 8) + conMod2;
              if (ch.classIndex) {
                const feats = await fetchLevelFeatures(ch.classIndex, lvl);
                const existing = new Set(ch.features || []);
                feats.forEach((f) => existing.add(f));
                ch.features = Array.from(existing);
                const asiFeat = feats.find((f) => /ability score/i.test(f));
                if (asiFeat) {
                  await promptAbilityScoreIncrease(ch);
                }
              }
            }
            ch.level = newLevel;
          }
          saveState(state);
          renderCharacterSheet(container, state);
        };
        container.appendChild(xpBtn);
      }
    }
    // Back button
    const backBtn = document.createElement('button');
    backBtn.className = 'btn btn-secondary';
    backBtn.style.marginTop = '1rem';
    backBtn.textContent = 'Back';
    backBtn.onclick = () => {
      window.history.back();
    };
    container.appendChild(backBtn);
  }

  /**
   * Render the session proposal form for a DM.  The campaignId is
   * passed via the URL hash (e.g. #propose-session?campaignId=123).
   * This form allows the DM to add multiple date/time/location
   * options and save them as a proposal.  Once saved, players can
   * vote and the DM can later finalize one of the options.
   *
   * @param {HTMLElement} container The root container
   * @param {object} state The application state
   */
  function renderProposeSession(container, state) {
    const params = new URLSearchParams(window.location.hash.split('?')[1]);
    const campId = params.get('campaignId');
    const campaign = state.campaigns.find((c) => c.id === campId);
    if (!campaign) {
      container.innerHTML = '<p>Campaign not found.</p>';
      return;
    }
    // Only allow the campaign owner to propose sessions
    if (campaign.ownerId !== state.currentUserId) {
      container.innerHTML = '<p>You do not have permission to propose sessions for this campaign.</p>';
      return;
    }
    container.innerHTML = `<h2>Propose New Session for ${campaign.name}</h2>
      <form id="proposalForm">
        <div id="timeSlots"></div>
        <button type="button" class="btn btn-secondary" id="addSlot">Add Time Slot</button>
        <button type="submit" class="btn btn-primary">Save Proposal</button>
      </form>
      <button class="btn btn-secondary" id="cancelProposal">Cancel</button>
    `;
    const timeSlotsDiv = document.getElementById('timeSlots');
    const addSlotBtn = document.getElementById('addSlot');
    const formEl = document.getElementById('proposalForm');
    const cancelBtn = document.getElementById('cancelProposal');
    // Helper to create a slot row
    function createSlotRow() {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'flex';
      wrapper.style.gap = '0.5rem';
      wrapper.style.alignItems = 'center';
      wrapper.style.marginBottom = '0.5rem';
      // Use text inputs for date and time instead of native date/time fields.  The
      // native controls are not always available in all environments (for example
      // when running the app as a local file or in headless browsers), which
      // makes them difficult to test.  By using simple text inputs with
      // placeholders we allow the user to enter values like "2025-08-02",
      // "18:00" and "22:00" directly.  The values are stored as strings and
      // parsed only when the proposal is saved.
      wrapper.innerHTML = `
        <input type="text" class="slot-date" placeholder="YYYY-MM-DD" required />
        <input type="text" class="slot-start" placeholder="HH:MM" required />
        <input type="text" class="slot-end" placeholder="HH:MM" required />
        <input type="text" class="slot-location" placeholder="Location" />
        <button type="button" class="btn btn-danger btn-small removeSlot">×</button>
      `;
      wrapper.querySelector('.removeSlot').onclick = () => {
        wrapper.remove();
      };
      return wrapper;
    }
    // Add initial slot
    timeSlotsDiv.appendChild(createSlotRow());
    addSlotBtn.onclick = () => {
      timeSlotsDiv.appendChild(createSlotRow());
    };
    // Cancel back to campaign
    cancelBtn.onclick = () => {
      window.history.back();
    };
    formEl.onsubmit = (e) => {
      e.preventDefault();
      // Gather all slot inputs
      const rows = timeSlotsDiv.querySelectorAll('div');
      const options = [];
      rows.forEach((row) => {
        const dateInput = row.querySelector('.slot-date');
        const startInput = row.querySelector('.slot-start');
        const endInput = row.querySelector('.slot-end');
        const locInput = row.querySelector('.slot-location');
        const date = dateInput.value;
        const start = startInput.value;
        const end = endInput.value;
        const location = locInput.value.trim() || '';
        if (date && start && end) {
          options.push({ date, start, end, location });
        }
      });
      if (options.length === 0) {
        alert('Please add at least one time slot.');
        return;
      }
      // Build proposal object
      const proposal = {
        id: uuid(),
        campaignId: campId,
        createdBy: state.currentUserId,
        finalized: false,
        finalChoiceIndex: null,
        options: options,
        // votes is an array of objects per option: { yes: [], no: [], maybe: [] }
        votes: options.map(() => ({ yes: [], no: [], maybe: [] })),
      };
      state.proposals.push(proposal);
      saveState(state);
      alert('Session proposal saved.');
      window.location.hash = `#campaign?id=${campId}`;
    };
  }

  /**
   * Parse a dice expression (e.g. "1d20+3-2d4") into an array of
   * terms.  Each term is an object describing either a dice roll or a
   * numeric modifier.  The parser supports multiple dice terms and
   * signed modifiers.
   * @param {string} expr The raw expression string
   * @returns {Array<{type:'dice',count:number,size:number,sign:number}|{type:'mod',mod:number}>}
   */
  function parseDiceExpression(expr) {
    if (!expr) return [];
    const cleaned = expr.replace(/\s+/g, '');
    const tokens = cleaned.match(/[+-]?\d*d\d+|[+-]?\d+/g);
    if (!tokens) return [];
    return tokens.map((tok) => {
      let sign = 1;
      if (tok.startsWith('-')) {
        sign = -1;
        tok = tok.slice(1);
      } else if (tok.startsWith('+')) {
        tok = tok.slice(1);
      }
      if (tok.includes('d')) {
        const parts = tok.split('d');
        const count = parts[0] === '' ? 1 : parseInt(parts[0], 10);
        const size = parseInt(parts[1], 10);
        return { type: 'dice', count: isNaN(count) ? 1 : count, size: isNaN(size) ? 6 : size, sign };
      }
      const modVal = parseInt(tok, 10);
      return { type: 'mod', mod: (isNaN(modVal) ? 0 : modVal) * sign };
    });
  }

  /**
   * Roll a dice expression and optionally record it to the global roll
   * log.  Returns an object describing the total, details string and
   * whether a critical success/failure occurred on a d20 roll.
   * @param {string} expr The expression to roll (e.g. "1d20+3")
   * @param {string} label A human‑readable label for the roll (optional)
   * @param {object} state The application state (optional)
   */
  function rollDice(expr, label = '', state) {
    const terms = parseDiceExpression(expr);
    let total = 0;
    const detailParts = [];
    let crit = null;
    terms.forEach((term) => {
      if (term.type === 'dice') {
        const results = [];
        for (let i = 0; i < term.count; i++) {
          const roll = Math.floor(Math.random() * term.size) + 1;
          results.push(roll);
          total += roll * term.sign;
          // Check for critical success/failure on single d20
          if (term.size === 20 && term.count === 1) {
            if (roll === 20) crit = 'success';
            else if (roll === 1) crit = 'failure';
          }
        }
        const prefix = term.sign === -1 ? '-' : '';
        detailParts.push(prefix + (results.length > 1 ? '[' + results.join(',') + ']' : results[0]));
      } else if (term.type === 'mod') {
        total += term.mod;
        detailParts.push(term.mod >= 0 ? '+' + term.mod : term.mod.toString());
      }
    });
    const details = detailParts.join('');
    // Record to log
    if (state && state.currentUserId) {
      const user = state.users.find((u) => u.id === state.currentUserId);
      const entry = {
        id: uuid(),
        timestamp: Date.now(),
        userId: state.currentUserId,
        userName: user ? user.username : 'Unknown',
        expression: expr,
        label: label || expr,
        result: total,
        details,
        crit,
        campaignId: state.currentCampaignId || null,
      };
      state.rolls.push(entry);
      // Keep logs trimmed to last 500 entries
      if (state.rolls.length > 500) {
        state.rolls = state.rolls.slice(-500);
      }
      saveState(state);
    }
    return { total, details, crit };
  }

  /**
   * Display recent dice rolls for a given campaign.  If campaignId
   * is null, shows recent personal rolls across all campaigns.  This
   * function appends elements to the provided container.  It does
   * not clear the container, to allow embedding multiple log sections.
   * @param {HTMLElement} container
   * @param {object} state
   * @param {string|null} campaignId
   */
  function renderRollLog(container, state, campaignId) {
    // Filter logs: if campaignId provided, show only those; otherwise show user's own
    let logs = state.rolls;
    if (campaignId) {
      logs = logs.filter((r) => r.campaignId === campaignId);
    } else if (state.currentUserId) {
      logs = logs.filter((r) => r.userId === state.currentUserId);
    }
    // Sort descending by time and take last 20
    logs = logs.slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
    const logList = document.createElement('ul');
    logList.className = 'list';
    logs.forEach((entry) => {
      const li = document.createElement('li');
      const timeStr = new Date(entry.timestamp).toLocaleTimeString();
      let text = `${timeStr} – ${entry.userName}: ${entry.label || entry.expression} = ${entry.result}`;
      if (entry.crit === 'success') text += ' 🟢';
      if (entry.crit === 'failure') text += ' 🔴';
      li.textContent = text;
      logList.appendChild(li);
    });
    // Clear previous log content
    container.innerHTML = '';
    container.appendChild(logList);
  }

  /**
   * Render a simple dice roller UI.  Allows the user to enter a dice
   * expression, roll it and see results.  Also displays recent logs
   * for the user's current campaign.
   * @param {HTMLElement} container
   * @param {object} state
   */
  function renderDiceRoller(container, state) {
    container.innerHTML = '<h2>Dice Roller</h2>';
    const form = document.createElement('div');
    form.style.marginBottom = '1rem';
    form.innerHTML = `
      <label for="diceExpr">Dice Expression:</label>
      <input type="text" id="diceExpr" value="1d20" placeholder="e.g. 2d6+3" />
      <button class="btn btn-primary" id="doRoll">Roll</button>
    `;
    container.appendChild(form);
    const resultDiv = document.createElement('div');
    resultDiv.id = 'diceResult';
    container.appendChild(resultDiv);
    const historyDiv = document.createElement('div');
    historyDiv.id = 'diceHistory';
    container.appendChild(historyDiv);
    document.getElementById('doRoll').onclick = () => {
      const expr = document.getElementById('diceExpr').value.trim();
      if (!expr) return;
      const { total, details, crit } = rollDice(expr, '', state);
      let msg = `<p><strong>Result:</strong> ${total} (${details})`;
      if (crit === 'success') msg += ' 🟢 Critical Success!';
      if (crit === 'failure') msg += ' 🔴 Critical Failure!';
      msg += '</p>';
      resultDiv.innerHTML = msg;
      // refresh log for current campaign
      renderRollLog(historyDiv, state, state.currentCampaignId || null);
    };
    // initial log display
    renderRollLog(historyDiv, state, state.currentCampaignId || null);
  }

  /**
   * Render an item library for browsing and adding equipment to
   * characters.  Provides a search box, results list, item details
   * and add‑to‑inventory controls.
   * @param {HTMLElement} container
   * @param {object} state
   */
  function renderItemLibrary(container, state) {
    container.innerHTML = '<h2>Item Library</h2>';
    const searchDiv = document.createElement('div');
    searchDiv.style.marginBottom = '1rem';
    searchDiv.innerHTML = `
      <input type="text" id="itemSearch" placeholder="Search items..." style="padding:0.5rem; width:60%;" />
      <button class="btn btn-primary" id="searchBtn">Search</button>
    `;
    container.appendChild(searchDiv);
    const resultsDiv = document.createElement('div');
    resultsDiv.id = 'itemResults';
    container.appendChild(resultsDiv);
    const detailDiv = document.createElement('div');
    detailDiv.id = 'itemDetail';
    container.appendChild(detailDiv);
    let allItems = [];
    // Fetch full equipment list on first use
    fetch('https://www.dnd5eapi.co/api/equipment')
      .then((res) => res.json())
      .then((data) => {
        allItems = data.results;
        // Show initial list (top 30)
        displayResults(allItems.slice(0, 30));
      })
      .catch(() => {
        resultsDiv.textContent = 'Failed to load items.';
      });
    function displayResults(list) {
      resultsDiv.innerHTML = '';
      const ul = document.createElement('ul');
      ul.className = 'list';
      list.forEach((item) => {
        const li = document.createElement('li');
        li.textContent = item.name;
        li.style.cursor = 'pointer';
        li.onclick = () => {
          showDetails(item);
        };
        ul.appendChild(li);
      });
      resultsDiv.appendChild(ul);
    }
    function showDetails(item) {
      detailDiv.innerHTML = '<p>Loading...</p>';
      fetch(`https://www.dnd5eapi.co${item.url}`)
        .then((res) => res.json())
        .then((data) => {
          let html = `<h3>${data.name}</h3>`;
          if (data.equipment_category) html += `<p><strong>Category:</strong> ${data.equipment_category.name}</p>`;
          if (data.weapon_category) html += `<p><strong>Weapon Category:</strong> ${data.weapon_category}</p>`;
          if (data.armor_category) html += `<p><strong>Armor Category:</strong> ${data.armor_category}</p>`;
          if (data.cost) html += `<p><strong>Cost:</strong> ${data.cost.quantity} ${data.cost.unit}</p>`;
          if (data.damage) html += `<p><strong>Damage:</strong> ${data.damage.dice_count}d${data.damage.dice_value} ${data.damage.damage_type.name}</p>`;
          if (data.weight) html += `<p><strong>Weight:</strong> ${data.weight} lb</p>`;
          if (data.properties && data.properties.length > 0) {
            html += `<p><strong>Properties:</strong> ${data.properties.map((p) => p.name).join(', ')}</p>`;
          }
          if (data.desc && data.desc.length > 0) {
            html += `<p>${data.desc.join('<br/>')}</p>`;
          }
          // Character selection to add item
          const ownedChars = state.characters.filter((c) => c.userId === state.currentUserId);
          if (ownedChars.length > 0) {
            html += '<p><strong>Add to character:</strong> <select id="addCharSelect"></select> <button id="addItemBtn" class="btn btn-secondary btn-small">Add</button></p>';
          }
          detailDiv.innerHTML = html;
          // Populate char select
          if (ownedChars.length > 0) {
            const sel = document.getElementById('addCharSelect');
            ownedChars.forEach((c) => {
              const opt = document.createElement('option');
              opt.value = c.id;
              opt.textContent = c.name;
              sel.appendChild(opt);
            });
            document.getElementById('addItemBtn').onclick = () => {
              const charId = sel.value;
              const ch = state.characters.find((c) => c.id === charId);
              if (!ch) return;
              if (!Array.isArray(ch.inventory)) ch.inventory = [];
              // Keep minimal item info
              ch.inventory.push({ name: data.name, index: data.index });
              saveState(state);
              alert(`${data.name} added to ${ch.name}'s inventory.`);
            };
          }
        })
        .catch(() => {
          detailDiv.textContent = 'Failed to load item details.';
        });
    }
    document.getElementById('searchBtn').onclick = () => {
      const q = document.getElementById('itemSearch').value.trim().toLowerCase();
      if (!q) {
        displayResults(allItems.slice(0, 30));
        return;
      }
      const filtered = allItems.filter((item) => item.name.toLowerCase().includes(q));
      displayResults(filtered.slice(0, 50));
    };
  }

  /**
   * Logout handler.  Clears current user and redirects to login page.
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