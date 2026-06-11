const TERMINAL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/></svg>`;

const XTERM_SCRIPT = 'web/vendor/xterm.js';
const FIT_SCRIPT = 'web/vendor/addon-fit.js';

export async function register(myrax) {
  await loadScript(myrax, XTERM_SCRIPT);
  await loadScript(myrax, FIT_SCRIPT);

  myrax.sidebar.add({
    value: 'terminal',
    label: 'Terminal',
    icon: TERMINAL_ICON,
    mount(node) {
      return mountTerminal(node, myrax);
    }
  });
}

function mountTerminal(node, myrax) {
  const root = document.createElement('section');
  root.className = 'myrax-terminal-shell';
  root.innerHTML = `
    <div class="myrax-terminal-toolbar">
      <div class="myrax-terminal-title">
        <span class="myrax-terminal-dot"></span>
        <span>Terminal</span>
      </div>
      <div class="myrax-terminal-actions">
        <span class="myrax-terminal-state">connecting</span>
        <button class="myrax-terminal-button" type="button" data-action="reconnect">reconnect</button>
        <button class="myrax-terminal-button" type="button" data-action="clear">clear</button>
      </div>
    </div>
    <div class="myrax-terminal-screen"></div>
  `;
  node.appendChild(root);

  const screen = root.querySelector('.myrax-terminal-screen');
  const state = root.querySelector('.myrax-terminal-state');
  const dot = root.querySelector('.myrax-terminal-dot');
  const reconnectButton = root.querySelector('[data-action="reconnect"]');
  const clearButton = root.querySelector('[data-action="clear"]');

  const TerminalCtor = window.Terminal?.Terminal || window.Terminal;
  const FitAddonCtor = window.FitAddon?.FitAddon || window.FitAddon;
  const fit = new FitAddonCtor();
  const terminal = new TerminalCtor({
    cursorBlink: true,
    cursorStyle: 'block',
    convertEol: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: 0,
    lineHeight: 1.2,
    scrollback: 6000,
    theme: {
      background: '#000000',
      foreground: '#f5f5f5',
      cursor: '#ffffff',
      cursorAccent: '#000000',
      selectionBackground: '#ffffff',
      selectionForeground: '#000000',
      black: '#000000',
      red: '#ffffff',
      green: '#ffffff',
      yellow: '#ffffff',
      blue: '#ffffff',
      magenta: '#ffffff',
      cyan: '#ffffff',
      white: '#ffffff',
      brightBlack: '#777777',
      brightRed: '#ffffff',
      brightGreen: '#ffffff',
      brightYellow: '#ffffff',
      brightBlue: '#ffffff',
      brightMagenta: '#ffffff',
      brightCyan: '#ffffff',
      brightWhite: '#ffffff'
    }
  });

  let socket = null;
  let disposed = false;
  let reconnectTimer = null;
  let fitTimer = null;

  terminal.loadAddon(fit);
  terminal.open(screen);
  fitSoon();
  fitSoon(80);
  terminal.focus();

  const dataDisposable = terminal.onData((data) => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(data);
    }
  });

  const resizeDisposable = terminal.onResize((size) => {
    sendResize(size.cols, size.rows);
  });

  let connectGeneration = 0;

  function setState(label, connected = false) {
    state.textContent = label;
    state.classList.toggle('is-connected', connected);
    dot.classList.toggle('is-connected', connected);
  }

  function connect() {
    const generation = ++connectGeneration;
    clearTimeout(reconnectTimer);
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.close();
    }
    setState('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const nextSocket = new WebSocket(`${protocol}://${window.location.host}/api/plugins/${myrax.id}/ws/terminal`);
    socket = nextSocket;
    nextSocket.binaryType = 'arraybuffer';

    nextSocket.onopen = () => {
      if (disposed || generation !== connectGeneration || nextSocket !== socket) {
        nextSocket.close();
        return;
      }
      setState('connected', true);
      fitSoon();
      sendResize(terminal.cols, terminal.rows);
      terminal.focus();
    };

    nextSocket.onmessage = async (event) => {
      if (generation !== connectGeneration || nextSocket !== socket) {
        return;
      }
      if (event.data instanceof ArrayBuffer) {
        terminal.write(new Uint8Array(event.data));
        return;
      }
      if (event.data?.arrayBuffer) {
        terminal.write(new Uint8Array(await event.data.arrayBuffer()));
        return;
      }
      terminal.write(String(event.data));
    };

    nextSocket.onerror = () => {
      if (generation !== connectGeneration || nextSocket !== socket) {
        return;
      }
      setState('error');
    };

    nextSocket.onclose = () => {
      if (disposed || generation !== connectGeneration || nextSocket !== socket) {
        return;
      }
      setState('closed');
      reconnectTimer = window.setTimeout(connect, 1400);
    };
  }

  function sendResize(cols, rows) {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'resize', cols, rows }));
    }
  }

  function fitSoon(delay = 0) {
    clearTimeout(fitTimer);
    fitTimer = window.setTimeout(() => {
      if (disposed) return;
      window.requestAnimationFrame(() => {
        if (disposed) return;
        fit.fit();
        sendResize(terminal.cols, terminal.rows);
      });
    }, delay);
  }

  const resizeObserver = new ResizeObserver(() => fitSoon());
  resizeObserver.observe(screen);

  reconnectButton.addEventListener('click', connect);
  clearButton.addEventListener('click', () => terminal.clear());
  window.addEventListener('resize', fitSoon);
  connect();

  return () => {
    disposed = true;
    clearTimeout(reconnectTimer);
    clearTimeout(fitTimer);
    resizeObserver.disconnect();
    window.removeEventListener('resize', fitSoon);
    reconnectButton.removeEventListener('click', connect);
    socket?.close();
    dataDisposable.dispose();
    resizeDisposable.dispose();
    terminal.dispose();
    root.remove();
  };
}

function loadScript(myrax, path) {
  const src = `/addons/${myrax.id}/${path}`;
  if (document.querySelector(`script[data-myrax-terminal-src="${src}"]`)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.myraxTerminalSrc = src;
    script.dataset.myraxPlugin = myrax.id;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load ${path}`));
    document.head.appendChild(script);
  });
}
