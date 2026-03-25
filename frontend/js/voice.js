'use strict';

import { Room, RoomEvent, Track } from 'https://cdn.jsdelivr.net/npm/livekit-client@2.15.8/dist/livekit-client.esm.mjs';
import state from './state.js';
import {
  dmCallBtn,
  voicePanel,
  voiceStatus, voiceJoinBtn, voiceLeaveBtn, voiceMicBtn, voiceDeafenBtn,
  voiceMicSelect, voiceOutputSelect, voiceTestMicBtn, voiceTestOutBtn, voiceMeter, voiceParticipants,
} from './dom.js';
import { send } from './helpers.js';

let meterTimer = null;
let levelCtx = null;
let levelAnalyser = null;
let levelData = null;

const activeVoiceChannel = () => state.voiceChannel || '';
const currentRoom = () => state.voiceRoom || null;

const LS_VOICE_CHANNEL = 'chatfc.voice.channel';
const LS_VOICE_MUTED = 'chatfc.voice.muted';
const LS_VOICE_DEAFENED = 'chatfc.voice.deafened';
const LS_VOICE_MIC_DEVICE = 'chatfc.voice.micDeviceId';
const LS_VOICE_OUTPUT_DEVICE = 'chatfc.voice.outputDeviceId';

const storageGet = (key) => {
  try { return localStorage.getItem(key); } catch (_) {}
  try { return sessionStorage.getItem(key); } catch (_) {}
  return null;
};

const storageSet = (key, value) => {
  try { localStorage.setItem(key, value); return; } catch (_) {}
  try { sessionStorage.setItem(key, value); return; } catch (_) {}
};

const storageRemove = (key) => {
  try { localStorage.removeItem(key); } catch (_) {}
  try { sessionStorage.removeItem(key); } catch (_) {}
};

const formatVoiceChannelLabel = (channel) => {
  if (!channel) return '';
  if (channel.startsWith('dm-')) return 'DM vocal';
  if (channel.startsWith('ch-')) return `#${channel.slice(3)}`;
  return channel;
};

const persistVoiceConfig = () => {
  if (state.voiceChannel) storageSet(LS_VOICE_CHANNEL, state.voiceChannel);
  storageSet(LS_VOICE_MUTED, state.voiceMuted ? '1' : '0');
  storageSet(LS_VOICE_DEAFENED, state.voiceDeafened ? '1' : '0');
  storageSet(LS_VOICE_MIC_DEVICE, state.voiceMicDeviceId || '');
  storageSet(LS_VOICE_OUTPUT_DEVICE, state.voiceOutputDeviceId || '');
};

const clearPersistedVoice = () => {
  storageRemove(LS_VOICE_CHANNEL);
  storageRemove(LS_VOICE_MUTED);
  storageRemove(LS_VOICE_DEAFENED);
  storageRemove(LS_VOICE_MIC_DEVICE);
  storageRemove(LS_VOICE_OUTPUT_DEVICE);
};

const normalizeDmRoomClient = (peer) => {
  const users = [String(state.myUsername || '').toLowerCase(), String(peer || '').toLowerCase()].sort();
  return `dm-${users[0]}-${users[1]}`;
};

const refreshControls = () => {
  const inVoice = !!currentRoom();
  if (voicePanel) {
    voicePanel.style.display = inVoice ? 'block' : 'none';
    const strongEl = voicePanel.querySelector('strong');
    if (strongEl) {
      const ch = activeVoiceChannel();
      strongEl.textContent = ch.startsWith('dm-') ? 'Vocal MP' : 'Vocal';
    }
  }
  if (voiceLeaveBtn) voiceLeaveBtn.disabled = !inVoice;
  if (voiceMicBtn) voiceMicBtn.disabled = !inVoice;
  if (voiceDeafenBtn) voiceDeafenBtn.disabled = !inVoice;
  if (voiceJoinBtn) voiceJoinBtn.disabled = inVoice || ((state.channelKinds.get(state.activeChannel) || 'text') !== 'voice');
  if (voiceMicBtn) voiceMicBtn.textContent = state.voiceMuted ? 'MIC OFF' : 'MIC ON';
  if (voiceDeafenBtn) voiceDeafenBtn.textContent = state.voiceDeafened ? 'HEADSET OFF' : 'HEADSET ON';
  if (voiceStatus) {
    if (currentRoom()) voiceStatus.textContent = `Connecté: ${formatVoiceChannelLabel(activeVoiceChannel())}`;
    else if (state.voiceChannel) voiceStatus.textContent = `Reconnexion: ${formatVoiceChannelLabel(activeVoiceChannel())}`;
    else voiceStatus.textContent = 'Hors canal vocal';
  }
};

const clearRemoteAudio = (username) => {
  const el = state.voiceAudioEls.get(username);
  if (el) { el.remove(); state.voiceAudioEls.delete(username); }
  state.voiceRemoteStreams.delete(username);
};

const applyOutputDevice = async () => {
  const outputId = state.voiceOutputDeviceId;
  if (!outputId) return;
  for (const el of state.voiceAudioEls.values()) {
    if (typeof el.setSinkId === 'function') {
      try { await el.setSinkId(outputId); } catch (_) {}
    }
  }
};

const resolveRemoteIdentity = (participant) => participant?.identity || participant?.name || participant?.sid || '';

const getParticipantKey = (participant) => {
  const key = resolveRemoteIdentity(participant);
  if (key) return String(key);
  return '';
};

const renderParticipants = () => {
  if (!voiceParticipants) return;
  const channel = activeVoiceChannel();
  if (!channel) {
    voiceParticipants.innerHTML = '<div class="voice-user-row"><div class="voice-user-left"><div class="voice-user-name">Aucun participant</div></div></div>';
    return;
  }
  const users = state.voiceMembers.get(channel) || [];
  if (!users.length) {
    voiceParticipants.innerHTML = '<div class="voice-user-row"><div class="voice-user-left"><div class="voice-user-name">En attente de participants...</div></div></div>';
    return;
  }
  voiceParticipants.innerHTML = '';

  const sorted = [...users].sort((a, b) => {
    const sa = !!state.voiceSpeaking.get(a);
    const sb = !!state.voiceSpeaking.get(b);
    if (sa !== sb) return sa ? -1 : 1;
    return String(a).localeCompare(String(b));
  });

  sorted.forEach((user) => {
    const speaking = !!state.voiceSpeaking.get(user);
    const row = document.createElement('div');
    row.className = 'voice-user-row';

    const left = document.createElement('div');
    left.className = 'voice-user-left';

    const indicator = document.createElement('div');
    indicator.className = 'voice-user-indicator' + (speaking ? ' speaking' : '');
    indicator.textContent = speaking ? '>' : '-';

    const nameEl = document.createElement('div');
    nameEl.className = 'voice-user-name';
    nameEl.textContent = user;

    left.appendChild(indicator);
    left.appendChild(nameEl);
    row.appendChild(left);

    if (user !== state.myUsername) {
      const volWrap = document.createElement('div');
      volWrap.className = 'voice-user-volume';

      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0';
      slider.max = '2';
      slider.step = '0.05';
      slider.value = String(state.voiceGainByUser.get(user) ?? 1);

      const text = document.createElement('div');
      text.className = 'voice-user-volume-text';
      text.textContent = `VOL ${Number(slider.value).toFixed(2)}`;

      slider.addEventListener('input', () => {
        const vol = Number(slider.value);
        state.voiceGainByUser.set(user, vol);
        const el = state.voiceAudioEls.get(user);
        if (el) el.volume = vol;
        text.textContent = `VOL ${vol.toFixed(2)}`;
      });

      volWrap.appendChild(text);
      volWrap.appendChild(slider);
      row.appendChild(volWrap);
    }

    voiceParticipants.appendChild(row);
  });
};

const setMicMeterValue = (pct) => {
  if (!voiceMeter) return;
  const safe = Math.max(0, Math.min(100, Math.round(Number(pct) || 0)));
  voiceMeter.innerHTML =
    `<div class="voice-meter-bar" aria-hidden="true"><div class="voice-meter-fill" style="width:${safe}%"></div></div>` +
    `<div class="voice-meter-text">MIC ${safe}%</div>`;
};

const startMicMeter = () => {
  if (!voiceMeter) return;
  const room = currentRoom();
  const pub = room?.localParticipant?.getTrackPublication(Track.Source.Microphone);
  const mediaTrack = pub?.track?.mediaStreamTrack;
  if (!mediaTrack) return;
  if (!levelCtx) levelCtx = new (window.AudioContext || window.webkitAudioContext)();
  levelAnalyser = levelCtx.createAnalyser();
  levelAnalyser.fftSize = 512;
  const src = levelCtx.createMediaStreamSource(new MediaStream([mediaTrack]));
  src.connect(levelAnalyser);
  levelData = new Uint8Array(levelAnalyser.frequencyBinCount);
  clearInterval(meterTimer);
  meterTimer = setInterval(() => {
    if (!levelAnalyser || !levelData) return;
    levelAnalyser.getByteFrequencyData(levelData);
    const avg = levelData.reduce((a, b) => a + b, 0) / levelData.length;
    // avg is roughly in [0..255]; map to a readable 0..100 scale.
    const pct = Math.max(0, Math.min(100, Math.round((avg / 255) * 100)));
    setMicMeterValue(pct);
  }, 200);
};

const attachRemoteTrack = async (participant, track) => {
  const mediaKind = track?.mediaStreamTrack?.kind || track?.kind;
  if (mediaKind && mediaKind !== 'audio') return;
  if (!track?.attach) return;

  const key = getParticipantKey(participant);
  if (!key) return;

  const audioEl = track.attach();
  audioEl.autoplay = true;
  audioEl.playsInline = true;
  audioEl.muted = state.voiceDeafened;
  audioEl.volume = state.voiceGainByUser.get(key) ?? 1;
  document.body.appendChild(audioEl);
  state.voiceAudioEls.set(key, audioEl);
  await applyOutputDevice();
};

const bindRoomEvents = (room) => {
  room.on(RoomEvent.TrackSubscribed, async (track, _publication, participant) => {
    await attachRemoteTrack(participant, track);
  });
  room.on(RoomEvent.TrackUnsubscribed, (_track, _pub, participant) => {
    const key = getParticipantKey(participant);
    if (key) clearRemoteAudio(key);
  });
  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    const key = getParticipantKey(participant);
    if (!key) return;
    clearRemoteAudio(key);
    state.voiceSpeaking.delete(key);
    const channel = activeVoiceChannel();
    const members = state.voiceMembers.get(channel) || [];
    state.voiceMembers.set(channel, members.filter((m) => m !== key));
    renderParticipants();
  });
  room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    const active = new Set(speakers.map((s) => getParticipantKey(s)).filter(Boolean));
    const channel = activeVoiceChannel();
    const users = state.voiceMembers.get(channel) || [];
    users.forEach((u) => state.voiceSpeaking.set(u, active.has(u)));
    state.voiceSpeaking.set(state.myUsername, room.localParticipant?.isSpeaking || false);
    renderParticipants();
  });
};

const stopVoice = async () => {
  const channel = activeVoiceChannel();
  if (channel) send({ type: 'voice_leave', channel });
  if (state.voiceRoom) {
    try { await state.voiceRoom.disconnect(); } catch (_) {}
    state.voiceRoom = null;
  }
  for (const user of Array.from(state.voiceAudioEls.keys())) clearRemoteAudio(user);
  clearInterval(meterTimer);
  meterTimer = null;
  state.dmCallTarget = null;
  state.voiceChannel = null;
  if (voicePanel) voicePanel.style.display = 'none';
  clearPersistedVoice();
  setMicMeterValue(0);
  refreshControls();
  renderParticipants();
};

const connectRoomWithToken = async ({ channel, url, token }) => {
  if (!channel || !url || !token) return;
  if (currentRoom()) await stopVoice();
  const room = new Room({ adaptiveStream: true, dynacast: true });
  bindRoomEvents(room);
  await room.connect(url, token);
  state.voiceRoom = room;
  state.voiceChannel = channel;
  persistVoiceConfig();
  setMicMeterValue(0);
  await room.localParticipant.setMicrophoneEnabled(!state.voiceMuted, { deviceId: state.voiceMicDeviceId || undefined });
  startMicMeter();
  refreshControls();
  renderParticipants();
};

const joinVoiceChannel = (channel) => {
  if (!channel) return;
  state.voiceChannel = channel; // show reconnecting UI immediately
  persistVoiceConfig();
  refreshControls();
  send({ type: 'voice_join', channel });
};

const startDmCall = () => {
  if (!state.activeDm) return;
  state.dmCallTarget = state.activeDm;
  const channel = normalizeDmRoomClient(state.activeDm);
  state.voiceChannel = channel;
  persistVoiceConfig();
  send({ type: 'voice_join', channel });
  refreshControls();
};

const refreshDevices = async () => {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  const mics = devices.filter((d) => d.kind === 'audioinput');
  const outs = devices.filter((d) => d.kind === 'audiooutput');
  if (voiceMicSelect) {
    voiceMicSelect.innerHTML = mics.map((d) => `<option value="${d.deviceId}">${d.label || 'Micro'}</option>`).join('');
    if (state.voiceMicDeviceId) voiceMicSelect.value = state.voiceMicDeviceId;
  }
  if (voiceOutputSelect) {
    voiceOutputSelect.innerHTML = outs.map((d) => `<option value="${d.deviceId}">${d.label || 'Sortie audio'}</option>`).join('');
    if (state.voiceOutputDeviceId) voiceOutputSelect.value = state.voiceOutputDeviceId;
  }
};

const testOutput = () => {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = 880;
  gain.gain.value = 0.05;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  setTimeout(() => osc.stop(), 180);
};

export const handleVoiceState = ({ channel, users }) => {
  state.voiceMembers.set(channel, Array.isArray(users) ? users : []);
  renderParticipants();
};

export const handleVoiceToken = async (msg) => {
  await connectRoomWithToken(msg);
};

export const handleVoiceSpeaking = ({ channel, username, speaking }) => {
  if (!channel || channel !== activeVoiceChannel()) return;
  state.voiceSpeaking.set(username, !!speaking);
  renderParticipants();
};

export const handleVoiceSignalMessage = async (_msg) => {};

export const resetVoice = () => {
  stopVoice().catch(() => {});
  state.voiceMembers.clear();
  state.voiceSpeaking.clear();
};

export const restoreVoiceIfNeeded = () => {
  const channel = storageGet(LS_VOICE_CHANNEL);
  if (!channel) return;
  if (currentRoom()) return;

  const muted = storageGet(LS_VOICE_MUTED);
  const deafened = storageGet(LS_VOICE_DEAFENED);
  const micDeviceId = storageGet(LS_VOICE_MIC_DEVICE) || '';
  const outputDeviceId = storageGet(LS_VOICE_OUTPUT_DEVICE) || '';

  state.voiceMuted = muted === '1';
  state.voiceDeafened = deafened === '1';
  state.voiceMicDeviceId = micDeviceId;
  state.voiceOutputDeviceId = outputDeviceId;

  state.voiceChannel = channel;
  refreshControls();
  // WS is guaranteed to be OPEN when ws.js calls us.
  send({ type: 'voice_join', channel });
};

export const initVoice = () => {
  refreshControls();
  refreshDevices();
  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
  }

  voiceJoinBtn?.addEventListener('click', () => {
    const kind = state.channelKinds.get(state.activeChannel) || 'text';
    if (kind !== 'voice') return;
    joinVoiceChannel(state.activeChannel);
  });
  voiceLeaveBtn?.addEventListener('click', () => { stopVoice().catch(() => {}); });
  dmCallBtn?.addEventListener('click', startDmCall);

  voiceMicBtn?.addEventListener('click', async () => {
    state.voiceMuted = !state.voiceMuted;
    const room = currentRoom();
    if (room) {
      try { await room.localParticipant.setMicrophoneEnabled(!state.voiceMuted); } catch (_) {}
    }
    persistVoiceConfig();
    refreshControls();
  });

  voiceDeafenBtn?.addEventListener('click', () => {
    state.voiceDeafened = !state.voiceDeafened;
    for (const el of state.voiceAudioEls.values()) el.muted = state.voiceDeafened;
    persistVoiceConfig();
    refreshControls();
  });

  voiceMicSelect?.addEventListener('change', async () => {
    state.voiceMicDeviceId = voiceMicSelect.value || '';
    const room = currentRoom();
    if (room) {
      try { await room.switchActiveDevice('audioinput', state.voiceMicDeviceId); } catch (_) {}
    }
    persistVoiceConfig();
  });

  voiceOutputSelect?.addEventListener('change', async () => {
    state.voiceOutputDeviceId = voiceOutputSelect.value || '';
    const room = currentRoom();
    if (room) {
      try { await room.switchActiveDevice('audiooutput', state.voiceOutputDeviceId); } catch (_) {}
    }
    await applyOutputDevice();
    persistVoiceConfig();
  });

  voiceTestMicBtn?.addEventListener('click', async () => {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    s.getTracks().forEach((t) => t.stop());
  });
  voiceTestOutBtn?.addEventListener('click', testOutput);
};
