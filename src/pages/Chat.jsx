import React, { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function Chat({ session }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [messages, setMessages] = useState([])
  const [conversation, setConversation] = useState(null)
  const [members, setMembers] = useState([])
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const bottomRef = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    fetchAll()

    const channel = supabase
      .channel(`messages:${id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${id}`
      }, payload => {
        setMessages(prev => [...prev, payload.new])
        markAsRead()
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function fetchAll() {
    setLoading(true)

    // 1. Récupérer la conversation
    const { data: conv } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', id)
      .single()
    setConversation(conv)

    // 2. Récupérer les membres avec leurs profils séparément
    const { data: memberRows } = await supabase
      .from('conversation_members')
      .select('user_id')
      .eq('conversation_id', id)

    if (memberRows && memberRows.length > 0) {
      const userIds = memberRows.map(m => m.user_id)
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, username')
        .in('id', userIds)
      setMembers(profileRows || [])
    }

    // 3. Récupérer les messages
    const { data: msgs } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', id)
      .order('created_at', { ascending: true })
    setMessages(msgs || [])

    setLoading(false)
    markAsRead()
  }

  async function markAsRead() {
    await supabase
      .from('messages')
      .update({ is_read: true })
      .eq('conversation_id', id)
      .neq('sender_id', session.user.id)
      .eq('is_read', false)
  }

  async function sendMessage(e) {
    e.preventDefault()
    if (!text.trim()) return
    const content = text.trim()
    setText('')
    const { data: newMsg } = await supabase.from('messages').insert({
      conversation_id: id,
      sender_id: session.user.id,
      content,
    }).select().single()
    if (newMsg) {
      setMessages(prev => [...prev, newMsg])
    }
  }
  async function sendImage(e) {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)

    const ext = file.name.split('.').pop()
    const fileName = `${session.user.id}_${Date.now()}.${ext}`

    const { error } = await supabase.storage
      .from('images')
      .upload(fileName, file)

    if (!error) {
      const { data: { publicUrl } } = supabase.storage
        .from('images')
        .getPublicUrl(fileName)

      await supabase.from('messages').insert({
        conversation_id: id,
        sender_id: session.user.id,
        image_url: publicUrl,
      })
    }
    setUploading(false)
    e.target.value = ''
  }

  function getConvName() {
    if (!conversation) return ''
    if (conversation.is_group) return conversation.name || 'Groupe'
    const other = members.find(m => m.id !== session.user.id)
    return other?.username || 'Inconnu'
  }

  function getInitial(name) {
    return name ? name[0].toUpperCase() : '?'
  }

  function getSenderName(senderId) {
    const m = members.find(m => m.id === senderId)
    return m?.username || 'Inconnu'
  }

  function formatTime(dateStr) {
    return new Date(dateStr).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  }

  function groupByDate(msgs) {
    const groups = {}
    msgs.forEach(msg => {
      const d = new Date(msg.created_at).toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long'
      })
      if (!groups[d]) groups[d] = []
      groups[d].push(msg)
    })
    return groups
  }

  const grouped = groupByDate(messages)
  const isGroup = conversation?.is_group

  return (
    <div className="chat-container">
      <div className="chat-header">
        <button className="back-btn" onClick={() => navigate('/')}>‹</button>
        <div className="chat-avatar">{getInitial(getConvName())}</div>
        <div className="chat-header-info">
          <span className="chat-name">{getConvName()}</span>
          {isGroup && <span className="chat-members">{members.length} membres</span>}
        </div>
      </div>

      <div className="messages-container">
        {loading ? (
          <div className="empty-state"><div className="spinner" /></div>
        ) : messages.length === 0 ? (
          <div className="empty-state">
            <p>Aucun message</p>
            <span>Sois le premier à écrire !</span>
          </div>
        ) : (
          Object.entries(grouped).map(([date, msgs]) => (
            <div key={date}>
              <div className="date-separator"><span>{date}</span></div>
              {msgs.map((msg, i) => {
                const isMe = msg.sender_id === session.user.id
                const prevMsg = msgs[i - 1]
                const showName = isGroup && !isMe && (!prevMsg || prevMsg.sender_id !== msg.sender_id)
                return (
                  <div key={msg.id} className={`message-row ${isMe ? 'me' : 'them'}`}>
                    {showName && <span className="sender-name">{getSenderName(msg.sender_id)}</span>}
                    <div className={`bubble ${isMe ? 'bubble-me' : 'bubble-them'}`}>
                      {msg.image_url ? (
                        <img src={msg.image_url} alt="photo" className="msg-image"
                          onClick={() => window.open(msg.image_url)} />
                      ) : (
                        <span>{msg.content}</span>
                      )}
                      <span className="msg-time">{formatTime(msg.created_at)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input-bar" onSubmit={sendMessage}>
        <button type="button" className="attach-btn"
          onClick={() => fileInputRef.current?.click()} disabled={uploading}>
          {uploading ? '⏳' : '📷'}
        </button>
        <input
          type="file"
          ref={fileInputRef}
          accept="image/*"
          style={{ display: 'none' }}
          onChange={sendImage}
        />
        <input
          className="chat-input"
          type="text"
          placeholder="Message..."
          value={text}
          onChange={e => setText(e.target.value)}
        />
        <button type="submit" className="send-btn" disabled={!text.trim()}>↑</button>
      </form>
    </div>
  )
}
