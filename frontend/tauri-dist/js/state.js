'use strict';

const state = {
  ws:              null,
  myUsername:      '',
  authMode:        'login',
  onlineUsers:     [],
  allUsers:        { online: [], offline: [] },
  mentionCount:    0,
  acIndex:         -1,
  emojiTarget:     null,
  activeMsgEmoji:  false,
  activeGif:       false,
  emojiActiveInput: null,
  gifContext:       'channel',
  currentEmojiCat: 0,
  gifDebounce:     null,
  replyingTo:      null,
  reconnectDelay:  1000,
  reconnectTimer:  null,
  heartbeatTimer:  null,
  intentionalDisc: false,

  // DM
  activeDm:   null,
  dmConvos:   new Map(),
  dmUnread:   new Map(),
  dmSeenIds:  new Set(),

  // File staging
  stagedFile: null, // legacy single-file reference
  stagedFiles: [],
  stagedDraft: '',

  // Channels
  channels:        ['general'],
  channelOwners:   new Map(),
  activeChannel:   'general',
  channelMessages: new Map(),
  channelUnread:   new Map(),

  // Typing
  typingState:    new Map(),
  typingThrottle: 0,

  // Custom emojis
  customEmojis: new Map(),
};

export default state;
