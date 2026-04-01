import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Home({ session }) {
  const [conversations, setConversations] = useState([])
  const [profiles, setProfiles] = useState([])
  const [myProfile, setMyProfile] = useState(null)
  const [showNewChat, setShowNewChat] = useState(false)
  const [showNewGroup, setShowNewGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [selectedUsers, setSelectedUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    fetchMyProfile()
    fetchConversations()
    fetchProfiles()
  }, [])

  async function fetchMyProfile() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single()
    setMyProfile(data)
  }

  async function fetchProfiles() {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .neq('id', session.user.id)
    setProfiles(data || [])
  }

  async function fetchConversations() {
    setLoading(true)
    // Récupérer les conversations où je suis membre
    const { data: memberData } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', session.user.id)

    if (!memberData || memberData.length === 0) {
      setConversations([])
      setLoading(false)
      return
    }

    const convIds = memberData.map(m => m.conversation_id)

    const { data: convData } = await supabase
      .from('conversations')
      .select('*')
      .in('id', convIds)
      .order('created_at', { ascending: false })

    // Pour chaque conversation, récupérer les membres et le dernier message
    const enriched = await Promise.all((convData || []).map(async (conv) => {
      const { data: members } = await supabase
        .from('conversation_members')
        .select('user_id, profiles(username)')
        .eq('conversation_id', conv.id)

      const { data: lastMsg } = await supabase
        .from('messages')
        .select('content, image_url, created_at')
        .eq('conversation_id', conv.id)
        .order('created_at', { ascending: false })
        .limit(1)

      // Unread count
      const { count } = await supabase
        .from('messages')
        .select('*', { count: 'exact', head: true })
        .eq('conversation_id', conv.id)
        .eq('is_read', false)
        .neq('sender_id', session.user.id)

      return { ...conv, members: members || [], lastMessage: lastMsg?.[0] || null, unreadCount: count || 0 }
    }))

    setConversations(enriched)
    setLoading(false)
  }

  async function startPrivateChat(userId) {
    // Vérifier si une conversation privée existe déjà
    const { data: myConvs } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', session.user.id)

    const { data: theirConvs } = await supabase
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', userId)

    const myIds = myConvs?.map(c => c.conversation_id) || []
    const theirIds = theirConvs?.map(c => c.conversation_id) || []
    const common = myIds.filter(id => theirIds.includes(id))

    if (common.length > 0) {
      // Vérifier que c'est bien une conversation privée (pas un groupe)
      const { data: conv } = await supabase
        .from('conversations')
        .select('*')
        .in('id', common)
        .eq('is_group', false)
        .single()
      if (conv) {
        navigate(`/chat/${conv.id}`)
        setShowNewChat(false)
        return
      }
    }

    // Créer une nouvelle conversation
    const { data: newConv } = await supabase
      .from('conversations')
      .insert({ is_group: false, created_by: session.user.id })
      .select()
      .single()

    await supabase.from('conversation_members').insert([
      { conversation_id: newConv.id, user_id: session.user.id },
      { conversation_id: newConv.id, user_id: userId },
    ])

    navigate(`/chat/${newConv.id}`)
    setShowNewChat(false)
  }

  async function createGroup() {
    if (!groupName.trim() || selectedUsers.length === 0) return

    const { data: newConv } = await supabase
      .from('conversations')
      .insert({ name: groupName, is_group: true, created_by: session.user.id })
      .select()
      .single()

    const members = [
      { conversation_id: newConv.id, user_id: session.user.id },
      ...selectedUsers.map(uid => ({ conversation_id: newConv.id, user_id: uid }))
    ]
    await supabase.from('conversation_members').insert(members)

    setGroupName('')
    setSelectedUsers([])
    setShowNewGroup(false)
    navigate(`/chat/${newConv.id}`)
  }

  function getConvName(conv) {
    if (conv.is_group) return conv.name
    const other = conv.members.find(m => m.user_id !== session.user.id)
    return other?.profiles?.username || 'Inconnu'
  }

  function getInitial(name) {
    return name ? name[0].toUpperCase() : '?'
  }

  function formatTime(dateStr) {
    if (!dateStr) return ''
    const d = new Date(dateStr)
    const now = new Date()
    if (d.toDateString() === now.toDateString()) {
      return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    }
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
  }

  return (
    <div className="home-container">
      {/* Header */}
      <div className="home-header">
        <h1>Messages</h1>
        <div className="header-actions">
          <button className="icon-btn" onClick={() => setShowNewGroup(true)} title="Nouveau groupe">👥</button>
          <button className="icon-btn" onClick={() => setShowNewChat(true)} title="Nouveau message">✏️</button>
          <button className="icon-btn logout" onClick={() => supabase.auth.signOut()} title="Déconnexion">⬅️</button>
        </div>
      </div>

      {/* Liste des conversations */}
      <div className="conv-list">
        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : conversations.length === 0 ? (
          <div className="empty-state">
            <p>Aucune conversation</p>
            <span>Appuie sur ✏️ pour démarrer une discussion</span>
          </div>
        ) : (
          conversations.map(conv => (
            <div key={conv.id} className="conv-item" onClick={() => navigate(`/chat/${conv.id}`)}>
              <div className="conv-avatar">{getInitial(getConvName(conv))}</div>
              <div className="conv-info">
                <div className="conv-top">
                  <span className="conv-name">{getConvName(conv)}</span>
                  <span className="conv-time">{formatTime(conv.lastMessage?.created_at)}</span>
                </div>
                <div className="conv-bottom">
                  <span className="conv-preview">
                    {conv.lastMessage?.image_url ? '📷 Photo' : conv.lastMessage?.content || 'Aucun message'}
                  </span>
                  {conv.unreadCount > 0 && <span className="unread-badge">{conv.unreadCount}</span>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Modal nouveau chat */}
      {showNewChat && (
        <div className="modal-overlay" onClick={() => setShowNewChat(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Nouveau message</h2>
              <button onClick={() => setShowNewChat(false)}>✕</button>
            </div>
            <div className="modal-list">
              {profiles.length === 0 ? (
                <p className="modal-empty">Aucun autre utilisateur pour l'instant</p>
              ) : profiles.map(p => (
                <div key={p.id} className="modal-item" onClick={() => startPrivateChat(p.id)}>
                  <div className="conv-avatar small">{getInitial(p.username)}</div>
                  <span>{p.username}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Modal nouveau groupe */}
      {showNewGroup && (
        <div className="modal-overlay" onClick={() => setShowNewGroup(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Nouveau groupe</h2>
              <button onClick={() => setShowNewGroup(false)}>✕</button>
            </div>
            <input
              className="modal-input"
              placeholder="Nom du groupe"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
            />
            <p className="modal-label">Membres :</p>
            <div className="modal-list">
              {profiles.map(p => (
                <div key={p.id} className={`modal-item ${selectedUsers.includes(p.id) ? 'selected' : ''}`}
                  onClick={() => setSelectedUsers(prev =>
                    prev.includes(p.id) ? prev.filter(id => id !== p.id) : [...prev, p.id]
                  )}>
                  <div className="conv-avatar small">{getInitial(p.username)}</div>
                  <span>{p.username}</span>
                  {selectedUsers.includes(p.id) && <span className="check">✓</span>}
                </div>
              ))}
            </div>
            <button className="btn-primary modal-btn" onClick={createGroup}
              disabled={!groupName.trim() || selectedUsers.length === 0}>
              Créer le groupe
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
