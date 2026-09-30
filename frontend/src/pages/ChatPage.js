import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import BackButton from '../components/BackButton';
import { useToast } from '../components/Toast';
import { getUserId } from '../services/auth';
import './chat.css';

import { API_BASE } from '../config';

function ChatPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { error } = useToast();
  const currentUserId = getUserId();

  const [activeTab, setActiveTab] = useState('claimed'); // 'claimed' or 'additional_info'
  const [conversations, setConversations] = useState([]);
  const [loadingConvs, setLoadingConvs] = useState(true);

  const [selectedConvId, setSelectedConvId] = useState(null);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingMessages, setLoadingMessages] = useState(false);

  const [inputMsg, setInputMsg] = useState('');
  const [sending, setSending] = useState(false);

  const messagesEndRef = useRef(null);

  // Parse URL query parameters
  const queryParams = new URLSearchParams(location.search);
  const targetConvId = queryParams.get('convId');
  const targetClaimId = queryParams.get('claimId');

  // Fetch user conversations
  const fetchConversations = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/api/conversations`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) {
        throw new Error('Failed to load conversations');
      }

      const data = await res.json();
      setConversations(data);

      // Handle query param targeting
      if (targetConvId) {
        const found = data.find((c) => c.id === parseInt(targetConvId, 10));
        if (found) {
          setActiveTab(found.type);
          setSelectedConvId(found.id);
        }
      } else if (targetClaimId) {
        const found = data.find((c) => c.claim_id === parseInt(targetClaimId, 10));
        if (found) {
          setActiveTab(found.type);
          setSelectedConvId(found.id);
        }
      }
    } catch (err) {
      error(err.message || 'Failed to load conversations');
    } finally {
      setLoadingConvs(false);
    }
  }, [targetConvId, targetClaimId, error]);

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(fetchConversations, 5000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  // Fetch messages for selected conversation
  const fetchMessages = useCallback(async (convId, isInitial = false) => {
    const token = localStorage.getItem('token');
    if (!token || !convId) return;

    if (isInitial) setLoadingMessages(true);

    try {
      const res = await fetch(`${API_BASE}/api/conversations/${convId}/messages`, {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!res.ok) throw new Error('Failed to load messages');

      const data = await res.json();
      setMessages(data);
    } catch (err) {
      console.error(err);
    } finally {
      if (isInitial) setLoadingMessages(false);
    }
  }, []);

  // Update activeConv state when selectedConvId changes
  useEffect(() => {
    if (selectedConvId) {
      const conv = conversations.find((c) => c.id === selectedConvId);
      setActiveConv(conv || null);
      fetchMessages(selectedConvId, true);
    } else {
      setActiveConv(null);
      setMessages([]);
    }
  }, [selectedConvId, conversations, fetchMessages]);

  // Polling active conversation messages every 3s
  useEffect(() => {
    if (!selectedConvId) return;
    const interval = setInterval(() => {
      fetchMessages(selectedConvId, false);
    }, 3000);
    return () => clearInterval(interval);
  }, [selectedConvId, fetchMessages]);

  // Auto scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle Send Message
  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputMsg.trim() || !selectedConvId || sending) return;

    const token = localStorage.getItem('token');
    setSending(true);

    try {
      const res = await fetch(`${API_BASE}/api/conversations/${selectedConvId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ message: inputMsg.trim() })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send message');
      }

      setInputMsg('');
      setMessages((prev) => [...prev, data]);
      fetchConversations();
    } catch (err) {
      error(err.message || 'Failed to send message');
    } finally {
      setSending(false);
    }
  };

  // Filter conversations by active tab
  const filteredConversations = conversations.filter((c) => c.type === activeTab);

  return (
    <div className="chat-page">
      <BackButton fallback="/dashboard" />

      <div className="chat-container">
        {/* SIDEBAR */}
        <aside className={`chat-sidebar ${selectedConvId ? 'mobile-hidden' : ''}`}>
          <div className="chat-sidebar-header">
            <h2>Messages</h2>
            <div className="chat-tabs">
              <button
                className={`tab-btn ${activeTab === 'claimed' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('claimed');
                  setSelectedConvId(null);
                }}
              >
                Claimed Items
              </button>
              <button
                className={`tab-btn ${activeTab === 'additional_info' ? 'active' : ''}`}
                onClick={() => {
                  setActiveTab('additional_info');
                  setSelectedConvId(null);
                }}
              >
                Additional Info
              </button>
            </div>
          </div>

          <div className="conv-list">
            {loadingConvs ? (
              <div className="chat-loading">
                <div className="chat-spinner" />
                <p>Loading chats...</p>
              </div>
            ) : filteredConversations.length === 0 ? (
              <div className="chat-empty-tab">
                <span>📭</span>
                <p>
                  {activeTab === 'claimed'
                    ? 'No claimed-item conversations yet.'
                    : 'No additional-info conversations yet.'}
                </p>
              </div>
            ) : (
              filteredConversations.map((conv) => (
                <div
                  key={conv.id}
                  className={`conv-item ${selectedConvId === conv.id ? 'selected' : ''}`}
                  onClick={() => setSelectedConvId(conv.id)}
                >
                  <div className="conv-item-icon">
                    {conv.type === 'claimed' ? '📦' : '❓'}
                  </div>
                  <div className="conv-item-details">
                    <div className="conv-item-top">
                      <h4>{conv.item.title}</h4>
                      <small>
                        {new Date(conv.last_message_at).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </small>
                    </div>
                    <div className="conv-item-participant">
                      User: {conv.other_participant}
                    </div>
                    <div className="conv-item-preview">
                      <p>{conv.last_message || 'No messages yet'}</p>
                      {conv.unread_count > 0 && (
                        <span className="conv-unread-badge">{conv.unread_count}</span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>

        {/* MAIN CHAT WINDOW */}
        <main className={`chat-main ${!selectedConvId ? 'mobile-hidden' : ''}`}>
          {activeConv ? (
            <>
              {/* CHAT HEADER */}
              <div className="chat-header">
                <button
                  className="chat-back-mobile"
                  onClick={() => setSelectedConvId(null)}
                >
                  ← Back
                </button>

                <div className="chat-header-info">
                  <div className="chat-header-icon">
                    {activeConv.type === 'claimed' ? '📦' : '📋'}
                  </div>
                  <div>
                    <h3>{activeConv.item.title}</h3>
                    <div className="chat-header-sub">
                      <span>Category: {activeConv.item.category}</span>
                      <span>•</span>
                      <span>With: {activeConv.other_participant}</span>
                    </div>
                  </div>
                </div>

                <div className="chat-header-badge-col">
                  <span className={`conv-type-badge ${activeConv.type}`}>
                    {activeConv.type === 'claimed' ? '✅ Claim Approved' : 'ℹ️ Info Requested'}
                  </span>
                  {activeConv.type === 'additional_info' && (
                    <button
                      className="review-claim-link-btn"
                      onClick={() => navigate('/review-claims')}
                    >
                      Review Claim
                    </button>
                  )}
                </div>
              </div>

              {/* CHAT MESSAGES BODY */}
              <div className="chat-body">
                {loadingMessages ? (
                  <div className="chat-loading">
                    <div className="chat-spinner" />
                    <p>Loading message history...</p>
                  </div>
                ) : messages.length === 0 ? (
                  <div className="chat-no-messages">
                    <span>💬</span>
                    <p>No messages yet. Start the conversation.</p>
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isMe = msg.sender_id === currentUserId;
                    return (
                      <div
                        key={msg.id}
                        className={`message-bubble-wrapper ${isMe ? 'me' : 'other'}`}
                      >
                        <div className="message-bubble">
                          <div className="message-sender-name">
                            {isMe ? 'You' : msg.sender_id}
                          </div>
                          <div className="message-text">{msg.message}</div>
                          <div className="message-time">
                            {new Date(msg.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit'
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* CHAT INPUT FOOTER */}
              <form className="chat-footer" onSubmit={handleSendMessage}>
                <input
                  type="text"
                  placeholder="Type your message..."
                  value={inputMsg}
                  onChange={(e) => setInputMsg(e.target.value)}
                  disabled={sending}
                />
                <button type="submit" disabled={sending || !inputMsg.trim()}>
                  {sending ? 'Sending...' : 'Send ➔'}
                </button>
              </form>
            </>
          ) : (
            <div className="chat-none-selected">
              <div className="none-icon">💬</div>
              <h2>Select a Conversation</h2>
              <p>Choose a claim from the list on the left to start messaging.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export default ChatPage;
