import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import './notification.css';

import { API_BASE } from '../config';

function NotificationDropdown() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const dropdownRef = useRef(null);

  const fetchNotifications = useCallback(async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res = await fetch(`${API_BASE}/api/notifications`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (err) {
      console.error('Error fetching notifications:', err);
    }
  }, []);

  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 8000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markAsRead = async (id) => {
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_BASE}/api/notifications/${id}/read`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchNotifications();
    } catch (err) {
      console.error(err);
    }
  };

  const markAllAsRead = async () => {
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_BASE}/api/notifications/read-all`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchNotifications();
    } catch (err) {
      console.error(err);
    }
  };

  const handleNotificationClick = async (n) => {
    if (!n.is_read) {
      await markAsRead(n.id);
    }
    setOpen(false);

    if (n.conversation_id) {
      navigate(`/chat?convId=${n.conversation_id}`);
    } else if (n.type === 'claim_submitted') {
      navigate('/review-claims');
    } else if (n.type === 'claim_approved' || n.type === 'claim_rejected') {
      navigate('/my-claims');
    } else {
      navigate('/dashboard');
    }
  };

  const getNotificationIcon = (type) => {
    switch (type) {
      case 'claim_submitted':
        return '📥';
      case 'claim_additional_info':
        return '💬';
      case 'claim_approved':
        return '🎉';
      case 'claim_rejected':
        return '❌';
      case 'new_message':
        return '✉️';
      default:
        return '🔔';
    }
  };

  return (
    <div className="notif-wrapper" ref={dropdownRef}>
      <button
        className="notif-bell-btn"
        onClick={() => setOpen(!open)}
        title="Notifications"
        aria-label="Notifications"
      >
        <span className="bell-icon">🔔</span>
        {unreadCount > 0 && (
          <span className="notif-badge">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-header">
            <h3>Notifications</h3>
            {unreadCount > 0 && (
              <button className="notif-read-all" onClick={markAllAsRead}>
                Mark all read
              </button>
            )}
          </div>

          <div className="notif-list">
            {notifications.length === 0 ? (
              <div className="notif-empty">
                <span>✨</span>
                <p>You're all caught up.</p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`notif-item ${!n.is_read ? 'unread' : ''}`}
                  onClick={() => handleNotificationClick(n)}
                >
                  <div className="notif-icon">{getNotificationIcon(n.type)}</div>
                  <div className="notif-content">
                    <div className="notif-title-row">
                      <h4>{n.title}</h4>
                      <small>{new Date(n.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>
                    </div>
                    <p>{n.message}</p>
                  </div>
                  {!n.is_read && <span className="unread-dot" />}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationDropdown;
