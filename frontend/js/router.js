'use strict';

import state from './state.js';
import { appendMessage, renderChannel, applyEdit, applyDelete, systemMsg } from './messages.js';
import { handleChannelList, handleTyping, applyTopic } from './channels.js';
import { handleEmojiList, applyReactions } from './emoji.js';
import { renderUsers, handleDmHistory, handleDmThread, handleDmMessage } from './dm.js';
import { scrollToBottom } from './helpers.js';

export const handleServer = (msg) => {
  switch (msg.type) {
    case 'history': {
      const histCh = msg.channel || 'general';
      const histMsgs = [];
      (Array.isArray(msg.messages) ? msg.messages : []).forEach(m => {
        histMsgs.push(m);
      });
      state.channelMessages.set(histCh, histMsgs);
      if (histCh === state.activeChannel) {
        renderChannel(state.activeChannel);
        scrollToBottom();
      }
      break;
    }
    case 'message':         appendMessage(msg.message, true); break;
    case 'system':          systemMsg(msg.content); break;
    case 'users':           renderUsers(msg.online, msg.offline); break;
    case 'reaction':        applyReactions(msg.message_id, msg.reactions); break;
    case 'message_edited':  applyEdit(msg.message_id, msg.content); break;
    case 'message_deleted': applyDelete(msg.message_id); break;
    case 'dm_history':      handleDmHistory(msg.dms); break;
    case 'dm_thread':       handleDmThread(msg.partner, msg.dms); break;
    case 'direct_message':  handleDmMessage(msg); break;
    case 'topic_changed':   applyTopic(msg.content); break;
    case 'channel_list':    handleChannelList(msg.channels); break;
    case 'typing':          handleTyping(msg); break;
    case 'emoji_list':      handleEmojiList(msg.emojis); renderChannel(state.activeChannel); break;
  }
};
