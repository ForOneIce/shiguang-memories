import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowRight, BookHeart, Check, ChevronLeft,
  ChevronRight, CloudOff, Download, ExternalLink, FileJson, FolderHeart, Heart, HelpCircle,
  Info, Plus, Search, Settings2, ShieldCheck, Sparkles, StickyNote,
  Trash2, Upload, X,
} from 'lucide-react';
import { ArchiveError, addNote, createArchive, deleteNote, setPreferences, updateNote } from './lib/archive.mjs';
import { createArchiveStore } from './lib/storage.mjs';
import { createExportFile, prepareFileImport, startFileDownload } from './lib/backup-files.mjs';
import { getLocalDateKey, getRoleMessages, getRoles, searchMessages } from './lib/reader.mjs';
import { createDemoArchive } from './content/demo.mjs';
import { sections as helpSections } from './content/help.mjs';

const PAGE_SIZE = 80;
const THEMES = [
  { id: 'sakura', name: '樱花来信', description: '柔粉与珠光，收藏日常的小小心动。', icon: '✿' },
  { id: 'purple', name: '莓紫夜游', description: '莓紫与星银，留一份自己的酷。', icon: '✧' },
  { id: 'yellow', name: '奶油电波', description: '奶油黄与晴空蓝，轻快一点点。', icon: '☼' },
];

function initials(name) { return [...(name || '友')][0]; }
function number(value) { return new Intl.NumberFormat('zh-CN').format(value); }
function dateLabel(value) {
  const key = getLocalDateKey(value);
  return key ? key.replace(/-/g, '.') : '日期未记录';
}
function timeLabel(value) {
  if (!value) return '';
  const numeric = typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : value;
  const date = new Date(typeof numeric === 'number' && numeric < 1e12 ? numeric * 1000 : numeric);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
}
function Highlight({ text = '', query = '' }) {
  const needle = query.trim();
  if (!needle) return text;
  const lower = text.toLocaleLowerCase();
  const find = needle.toLocaleLowerCase();
  const parts = [];
  let at = 0;
  let index = lower.indexOf(find);
  while (index !== -1) {
    parts.push(text.slice(at, index), <mark key={index}>{text.slice(index, index + needle.length)}</mark>);
    at = index + needle.length;
    index = lower.indexOf(find, at);
  }
  parts.push(text.slice(at));
  return parts;
}
function Dialog({ title, children, onClose, busy = false, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);
  return <dialog ref={ref} className={`app-dialog ${wide ? 'wide' : ''}`} aria-labelledby="dialog-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === ref.current && !busy) onClose(); }}>
    <div className="dialog-inner">
      <header className="dialog-header"><div><span className="eyebrow">YOUR LITTLE CORNER</span><h2 id="dialog-title">{title}</h2></div>
        <button className="icon-button" aria-label="关闭窗口" onClick={onClose} disabled={busy}><X size={20} /></button>
      </header>
      <div className="dialog-body">{children}</div>
    </div>
  </dialog>;
}
function Help({ initial = false }) {
  return <div className="help-list">{helpSections.map((section, i) => <details className="help-section" key={section.id} open={initial && i === 0 ? true : undefined}>
    <summary>{section.title}<ChevronRight size={16} /></summary>
    <div className="help-content">
      {section.paragraphs?.map((text, index) => <p key={index}>{text}</p>)}
      {section.steps && <ol>{section.steps.map((text, index) => <li key={index}>{text}</li>)}</ol>}
      {section.options?.map(option => <p key={option.title}><strong>{option.title}</strong><br />{option.description}</p>)}
      {section.notes?.map((text, index) => <p className="muted" key={index}>{text}</p>)}
      {section.questions?.map(item => <div className="faq-item" key={item.question}><strong>{item.question}</strong><p>{item.answer}</p></div>)}
    </div>
  </details>)}</div>;
}

function StorageSpaceHelp({ isImport = false }) {
  return <details className="help-section storage-space-help">
    <summary>空间不足时，可以怎么做？<ChevronRight size={16} /></summary>
    <p>先保留原文件，整理设备中不需要的其他文件，再回来选择“重试保存”。请先不要清除拾光的网站数据，这里已有的记录和便笺需要一起保留。</p>
    <p>浏览器也可能达到这个网站的保存限额。如果仍无法保存，可以在另一台有空间的设备上导入原文件；若要带走这里已有的便笺，请先将完整备份下载到有空间的位置，并确认文件已经下载。</p>
    <p>{isImport ? '如果本机暂时无法下载，不用反复尝试。导入的原文件没有改变，可以先返回原有记录，之后再来。' : '如果本机暂时无法下载，请先保留这一页。本次修改仍留在页面中，可以在整理好空间后重试保存。'}</p>
  </details>;
}

export default function App() {
  const [library, setLibrary] = useState(() => createArchive());
  const [demo, setDemo] = useState(null);
  const archive = demo ?? library;
  const store = useMemo(() => createArchiveStore(), []);
  const [storageMode, setStorageMode] = useState('loading');
  const [storageIssue, setStorageIssue] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const [modal, setModal] = useState(null);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [roleFilter, setRoleFilter] = useState('');
  const [conversationId, setConversationId] = useState('all');
  const [readerTab, setReaderTab] = useState('history');
  const [showSidebar, setShowSidebar] = useState(true);
  const [page, setPage] = useState(0);
  const [focusMessage, setFocusMessage] = useState(null);
  const [highlightQuery, setHighlightQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const [pendingImport, setPendingImport] = useState(null);
  const [importError, setImportError] = useState('');
  const [importReview, setImportReview] = useState(null);
  const [search, setSearch] = useState({ query: '', roleId: '', from: '', to: '' });
  const [searchPage, setSearchPage] = useState(0);
  const [noteDrafts, setNoteDrafts] = useState({});
  const [deletingNote, setDeletingNote] = useState(null);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  useEffect(() => {
    let active = true;
    store.readArchive().then(saved => {
      if (!active) return;
      setLibrary(saved);
      setStorageMode('ready');
    }).catch(error => {
      if (!active) return;
      setStorageMode('session');
      setStorageIssue(error.message || '本地记录暂时无法读取。原有内容没有改变，仍可以在本页查看文件。');
    });
    return () => { active = false; store.close(); };
  }, [store]);

  const roles = useMemo(() => getRoles(archive.conversations), [archive.conversations]);
  const role = roles.find(item => item.id === selectedRoleId) ?? roles[0] ?? null;
  const draftKey = `${demo ? 'demo' : 'library'}:${role?.id ?? ''}`;
  const noteBody = noteDrafts[draftKey]?.body ?? '';
  const editingNote = noteDrafts[draftKey]?.editing ?? null;
  function setNoteBody(body) { setNoteDrafts(current => ({ ...current, [draftKey]: { ...current[draftKey], body } })); }
  function setEditingNote(editing) { setNoteDrafts(current => ({ ...current, [draftKey]: { ...current[draftKey], editing } })); }
  const visibleRoles = useMemo(() => roles.filter(item => item.name.toLocaleLowerCase().includes(roleFilter.trim().toLocaleLowerCase())), [roles, roleFilter]);
  const roleMessages = useMemo(() => role ? getRoleMessages(archive.conversations, role.id) : [], [archive.conversations, role?.id]);
  const messages = useMemo(() => conversationId === 'all' ? roleMessages : roleMessages.filter(message => message.conversationId === conversationId), [roleMessages, conversationId]);
  const lastPage = Math.max(0, Math.ceil(messages.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const shownMessages = messages.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const stats = useMemo(() => ({ roles: roles.length, conversations: archive.conversations.length, messages: archive.conversations.reduce((total, item) => total + item.messages.length, 0), notes: archive.notes.length }), [archive, roles]);
  const searchInvalid = Boolean(search.from && search.to && search.from > search.to);
  const searchActive = Boolean(search.query.trim() || search.from || search.to || search.roleId);
  const results = useMemo(() => !searchActive || searchInvalid ? [] : searchMessages(archive.conversations, search), [archive.conversations, search, searchActive, searchInvalid]);
  const roleNotes = useMemo(() => {
    const ids = new Set(role?.conversations.map(item => item.conversation_id) ?? []);
    return archive.notes.filter(note => ids.has(note.conversationId)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [archive.notes, role]);
  const hasUnsavedDrafts = useMemo(() => Object.entries(noteDrafts).some(([key, draft]) => {
    if (!key.startsWith('library:') || !draft.body?.trim()) return false;
    return !draft.editing || library.notes.find(note => note.id === draft.editing)?.body !== draft.body;
  }), [noteDrafts, library.notes]);

  useEffect(() => {
    if (!hasUnsavedDrafts && !recovery) return;
    const protectUnsavedContent = event => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectUnsavedContent);
    return () => window.removeEventListener('beforeunload', protectUnsavedContent);
  }, [hasUnsavedDrafts, recovery]);

  useEffect(() => {
    if (focusMessage) {
      const frame = requestAnimationFrame(() => document.getElementById(`message-${focusMessage}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      return () => cancelAnimationFrame(frame);
    }
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [currentPage, role?.id, conversationId, focusMessage, readerTab]);

  function selectRole(id) {
    setSelectedRoleId(id); setConversationId('all'); setPage(0); setFocusMessage(null);
    setHighlightQuery(''); setReaderTab('history'); setShowSidebar(false);
    setDeletingNote(null);
  }
  function setWorking(value) { busyRef.current = value; setBusy(value); }
  async function persist(candidate, { source = 'change', message = '已保存在当前浏览器。', noteDraft = null, deletedNoteId = null, forceLibrary = false, recovering = false } = {}) {
    if (busyRef.current) return false;
    // A failed candidate may be the only copy of a user's changes. Never replace
    // or clear it as a side effect of a later, unrelated write.
    if (recovery && !recovering) {
      setNotice({ kind: 'warning', text: '还有一次修改尚未保存。请先导出“本次未保存内容”，并按提示处理后再保存新修改；当前输入的便笺草稿仍留在本页。' });
      return false;
    }
    if (demo && source !== 'import' && !forceLibrary) {
      setDemo(candidate);
      setNotice({ kind: 'info', text: '示例中的修改只在本页体验，不会写入你的记录。' });
      return true;
    }
    if (storageMode !== 'ready') {
      setLibrary(candidate); setDemo(null); setRecovery(null);
      setNotice({ kind: 'warning', text: '已在本页打开，尚未保存在浏览器中。离开前请导出完整备份，并保留原文件。' });
      return true;
    }
    setWorking(true);
    try {
      const saved = await store.saveArchive(candidate);
      setLibrary(saved); setDemo(null); setRecovery(null);
      setNotice({ kind: 'success', text: message });
      return true;
    } catch (error) {
      const failureMessage = error.code === 'STALE_STATE'
        ? '另一个页面保存了新内容。请先导出“本次未保存内容”，确认文件已下载后再刷新本页，读取另一页面保存的记录。本次修改不会自动覆盖它们。'
        : error.message || '这次内容尚未保存，原有记录没有改变。可以先导出包含本次修改的完整备份。';
      setRecovery({ archive: candidate, source, message: failureMessage, code: error.code, noteDraft, deletedNoteId });
      setNotice({ kind: 'warning', text: failureMessage });
      return false;
    } finally { setWorking(false); }
  }
  async function importFiles(files, { allowLargeFiles = false } = {}) {
    if (!files?.length || busyRef.current || storageMode === 'loading') return;
    if (recovery) {
      setNotice({ kind: 'warning', text: '还有一次修改尚未保存，请先导出“本次未保存内容”，并按提示处理后再添加文件。本次选择的文件和原有记录都没有改变。' });
      if (inputRef.current) inputRef.current.value = '';
      return;
    }
    const selectedFiles = Array.from(files);
    setModal('import'); setPendingImport(null); setImportError(''); setImportReview(null); setWorking(true);
    try {
      // Even inside the demo, import into the real library so examples never leak into it.
      const prepared = await prepareFileImport(selectedFiles, library, { allowLargeFiles });
      const importedRoles = getRoles(prepared.archive.conversations);
      const previousIds = new Set(library.conversations.map(item => item.conversation_id));
      const incomingNames = [...new Set(prepared.archive.conversations.filter(item => !previousIds.has(item.conversation_id)).map(item => item.bot_name || item.conversation_name || '未命名角色'))];
      setPendingImport({ ...prepared, roles: importedRoles, names: incomingNames });
    } catch (error) {
      if (['LARGE_FILE_REVIEW', 'LARGE_BATCH_REVIEW'].includes(error.code)) {
        setImportReview(selectedFiles);
      }
      setImportError(error instanceof ArchiveError ? error.message : '这次还没能整理完这些记录。原文件和之前保存的内容没有改变。可以先关闭不需要的浏览器标签页，再回来试试；一次少选几份文件，也能减少整理时的负担。');
    }
    finally { setWorking(false); if (inputRef.current) inputRef.current.value = ''; }
  }
  function returnFromImport() {
    if (busyRef.current) return;
    // An import candidate comes from files the user still holds. Leaving this
    // attempt discards only the in-memory candidate, never the saved library.
    setPendingImport(null); setImportError(''); setImportReview(null);
    if (recovery?.source === 'import') setRecovery(null);
    setModal(null);
    setNotice({ kind: 'info', text: '已结束这次导入，原文件和之前保存的记录都没有改变。方便时，可以重新选择文件继续。' });
  }
  function closeModal() {
    if (modal === 'import' && !recovery) {
      setPendingImport(null); setImportError(''); setImportReview(null);
    }
    setModal(null);
  }
  async function confirmImport() {
    if (!pendingImport) return;
    if (recovery?.source === 'import' && recovery.archive === pendingImport.archive && recovery.code !== 'STALE_STATE') {
      await retryRecovery();
      return;
    }
    if (await persist(pendingImport.archive, { source: 'import', message: '对话已保存在当前浏览器。原备份请继续留好，随时可以慢慢翻看。' })) {
      setModal(null); setPendingImport(null); setSelectedRoleId(null); setPage(0);
      setConversationId('all'); setReaderTab('history'); setShowSidebar(false); setHighlightQuery(''); setFocusMessage(null);
    }
  }
  async function retryRecovery() {
    if (!recovery) return;
    const { source, noteDraft, deletedNoteId } = recovery;
    if (await persist(recovery.archive, { source, noteDraft, deletedNoteId, forceLibrary: true, recovering: true })) {
      if (source === 'import') {
        setModal(null); setPendingImport(null); setSelectedRoleId(null); setPage(0);
        setConversationId('all'); setReaderTab('history'); setShowSidebar(false);
        setHighlightQuery(''); setFocusMessage(null);
      }
      if (noteDraft) {
        setNoteDrafts(current => current[noteDraft.key]?.body === noteDraft.body && (current[noteDraft.key]?.editing ?? null) === noteDraft.editing
          ? { ...current, [noteDraft.key]: { body: '', editing: null } } : current);
      }
      if (deletedNoteId) {
        setDeletingNote(null);
        setNoteDrafts(current => Object.fromEntries(Object.entries(current).map(([key, draft]) => [key,
          draft.editing === deletedNoteId ? { body: '', editing: null } : draft])));
      }
    }
  }
  function exportData(kind = 'full', data = archive, draft = false) {
    try {
      const file = createExportFile(data, { kind });
      startFileDownload(file);
      setNotice({ kind: 'info', text: `${draft ? '包含本次未保存修改的备份' : demo && data === archive ? '示例备份' : '备份'}已开始下载。请到浏览器下载列表确认文件已下载，并保留在自己信任的位置。` });
    } catch (error) { setNotice({ kind: 'warning', text: error.message || '下载暂未开始，请保留当前页面后再试。' }); }
  }
  async function changePreferences(changes) {
    try { await persist(setPreferences(archive, changes), { message: '外观设置已保存在当前浏览器。' }); }
    catch (error) { setNotice({ kind: 'warning', text: error.message }); }
  }
  function startDemo() {
    setDemo(createDemoArchive()); setSelectedRoleId(null); setPage(0); setConversationId('all');
    setReaderTab('history'); setShowSidebar(false); setNotice(null); setFocusMessage(null); setHighlightQuery('');
  }
  function leaveDemo() {
    setDemo(null); setSelectedRoleId(null); setPage(0); setConversationId('all');
    setReaderTab('history'); setShowSidebar(true); setNotice(null);
  }
  function openSearch() { setSearch(current => ({ ...current, roleId: '' })); setSearchPage(0); setModal('search'); }
  function updateSearch(changes) { setSearch(current => ({ ...current, ...changes })); setSearchPage(0); }
  function jumpToMessage(message) {
    const all = getRoleMessages(archive.conversations, message.roleId);
    const index = all.findIndex(item => item.message_id === message.message_id);
    setSelectedRoleId(message.roleId); setConversationId('all'); setPage(Math.max(0, Math.floor(index / PAGE_SIZE)));
    setReaderTab('history'); setShowSidebar(false); setFocusMessage(message.message_id);
    setHighlightQuery(search.query); setModal(null);
  }
  async function saveNote(event) {
    event.preventDefault();
    if (!noteBody.trim() || !role || busy) return;
    try {
      const next = editingNote ? updateNote(archive, editingNote, noteBody) : addNote(archive, {
        conversationId: conversationId === 'all' ? role.conversations[0].conversation_id : conversationId,
        body: noteBody,
      });
      if (await persist(next, { source: 'note', message: '便笺已保存在当前浏览器。导出完整备份，可以把这一页一起带走。', noteDraft: { key: draftKey, body: noteBody, editing: editingNote } })) {
        // Saving is asynchronous; preserve anything typed while the save was in flight.
        setNoteDrafts(current => current[draftKey]?.body === noteBody && (current[draftKey]?.editing ?? null) === editingNote
          ? { ...current, [draftKey]: { body: '', editing: null } } : current);
      }
    } catch (error) { setNotice({ kind: 'warning', text: error.message }); }
  }
  async function removeNote(id) {
    try {
      if (await persist(deleteNote(archive, id), { source: 'delete-note', deletedNoteId: id, message: '这页便笺已移除，原始对话没有改变。' })) {
        setDeletingNote(null);
        if (editingNote === id) { setEditingNote(null); setNoteBody(''); }
      }
    } catch (error) { setNotice({ kind: 'warning', text: error.message }); }
  }

  const rootStyle = { '--reader-font-size': `${archive.preferences.fontSize}px` };
  const renderStatus = () => <>
    {storageMode === 'session' && <div className="status-banner warning"><CloudOff size={17} /><div><strong>当前只在本页使用</strong><p>{storageIssue} 导入和便笺仍可使用；关闭页面前，请导出完整备份。</p></div></div>}
    {demo && <div className="status-banner demo-banner"><Sparkles size={17} /><p>你正在阅读虚构示例。示例中的修改只保留在本页。</p><button className="button ghost small" onClick={leaveDemo}>返回我的记录<ArrowRight size={15} /></button></div>}
    {notice && <div className={`status-banner ${notice.kind}`} role="status"><Info size={17} /><p>{notice.text}</p><button className="icon-button" aria-label="收起提示" onClick={() => setNotice(null)}><X size={16} /></button></div>}
    {recovery && <div className="status-banner warning" role="alert"><Info size={17} /><div>
      <strong>{recovery.source === 'import' ? '这次导入还未保存' : '本次修改还没有保存'}</strong><p>{recovery.message}</p>
      {recovery.code === 'STORAGE_FULL' && <StorageSpaceHelp isImport={recovery.source === 'import'} />}
      <div className="status-actions">
        <button className="button secondary small" onClick={() => exportData('full', recovery.archive, true)}><Download size={15} />导出本次未保存内容</button>
        {recovery.code !== 'STALE_STATE' && <button className="button ghost small" disabled={busy} onClick={retryRecovery}>重试保存</button>}
        {recovery.source === 'import' && <button className="button ghost small" disabled={busy} onClick={returnFromImport}>先返回，稍后再试</button>}
      </div>
    </div></div>}
  </>;

  return <div className="app-shell" data-theme={archive.preferences.theme} data-decorations={archive.preferences.decorations} style={rootStyle}>
    <input className="sr-only" ref={inputRef} type="file" multiple accept="application/json,.json" aria-label="选择对话 JSON 文件" onChange={event => importFiles(event.target.files)} tabIndex={-1} />
    <header className="topbar">
      <a className="brand" href="#" onClick={event => { event.preventDefault(); if (roles.length) setShowSidebar(true); }} aria-label="拾光，我的对话手册">
        <span className="brand-mark"><BookHeart size={25} strokeWidth={1.65} /></span><span className="brand-copy"><strong>拾光<span className="brand-sparkle">✧</span></strong><span>把回忆轻轻收好</span></span>
      </a>
      <div className="topbar-actions">
        <div className="theme-switcher" aria-label="切换外观">{THEMES.map(theme => <button key={theme.id} className={`theme-dot theme-${theme.id} ${archive.preferences.theme === theme.id ? 'active' : ''}`} title={theme.name} aria-label={`切换${theme.name}`} aria-pressed={archive.preferences.theme === theme.id} disabled={busy || storageMode === 'loading'} onClick={() => changePreferences({ theme: theme.id })}>{archive.preferences.theme === theme.id && <Check size={12} />}</button>)}</div>
        {roles.length > 0 && <button className="icon-button" onClick={openSearch} aria-label="搜索全部对话"><Search size={19} /></button>}
        <button className="button ghost settings-trigger" onClick={() => setModal('settings')}><Settings2 size={17} /><span>设置与帮助</span></button>
      </div>
    </header>
    <div className="global-status">{renderStatus()}</div>
    {storageMode === 'loading' ? <main className="loading-state"><BookHeart size={35} /><h1>正在打开你的对话手册</h1><p className="muted">稍等片刻，让记录回到熟悉的位置。</p></main> : roles.length === 0 ?
      <main className="welcome">
        <section className="welcome-copy">
          <span className="welcome-badge"><Sparkles size={14} />一本属于我们的备忘录</span>
          <h1 className="welcome-title">那些还未遗忘的过往，<br /><em>在这里，慢慢翻看。</em></h1>
          <p className="welcome-description">放进一份对话备份，让熟悉的文字回到对话框。<br />读一段，写一页便笺，按自己的节奏就好。</p>
          <div className={`import-dropzone ${dragging ? 'is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); importFiles(event.dataTransfer.files); }}>
            <span className="import-icon"><FolderHeart size={31} strokeWidth={1.4} /></span><div><h2>把对话轻轻放在这里</h2><p>拖入 JSON 文件，或点击下方按钮选择</p></div>
            <div className="import-actions"><button className="button primary" onClick={() => inputRef.current?.click()} disabled={busy}><Plus size={18} />添加对话</button><button className="button ghost" onClick={startDemo}>先看看示例<ArrowRight size={16} /></button></div>
            <span className="privacy-note"><ShieldCheck size={14} />文件在当前设备读取，不会上传</span>
          </div>
          <button className="button ghost help-link" onClick={() => setModal('help')}><HelpCircle size={16} />第一次使用？跟着小指引开始</button>
        </section>
        <div className="welcome-art" aria-hidden="true">
          <span className="art-sparkle sparkle-one">✦</span><span className="art-sparkle sparkle-two">✧</span><span className="art-sticker">a little everyday magic</span>
          <div className="memory-card card-back"><div className="card-label">LITTLE THINGS / 01</div><span className="card-flower">✿</span><p>把今天的好天气<br />也放进收藏夹。</p></div>
          <div className="memory-card card-front"><div className="card-label">MY CONVERSATION JOURNAL <Heart size={13} /></div><div className="art-conversation"><span className="avatar">晴</span><span>今天看到了很漂亮的云。</span></div><div className="art-reply">那就给今天加一颗小星星 ✧</div><div className="card-bottom">一些对话，一点温暖。<span>✦</span></div></div>
          <span className="art-caption">文字示意 · 每一页，都由你珍藏</span>
        </div>
        <div className="welcome-features"><span><ShieldCheck size={17} /><b>只在你的设备</b><small>无需注册，安心翻看</small></span><span><Search size={17} /><b>找到想看的那一句</b><small>按文字、日期与角色查找</small></span><span><Download size={17} /><b>随时带走你的记录</b><small>导出备份，换设备也方便</small></span></div>
      </main> :
      <main className={`app-main ${showSidebar ? 'show-sidebar' : ''}`}>
        <aside className="sidebar" aria-label="角色列表">
          <div className="sidebar-heading"><div><span className="eyebrow">MY LITTLE UNIVERSE</span><h1>我的对话<span>{roles.length}</span></h1></div><button className="icon-button" aria-label="添加对话" onClick={() => inputRef.current?.click()} disabled={busy}><Plus size={21} /></button></div>
          <label className="role-filter"><Search size={16} /><input value={roleFilter} onChange={event => setRoleFilter(event.target.value)} placeholder="找一位熟悉的角色" aria-label="筛选角色" /></label>
          <div className="role-list">{visibleRoles.map((item, index) => <button key={item.id} className={`role-card ${role?.id === item.id ? 'active' : ''}`} onClick={() => selectRole(item.id)} aria-current={role?.id === item.id ? 'true' : undefined}>
            <span className={`avatar avatar-color-${index % 5}`}>{initials(item.name)}</span><span className="role-card-copy"><span className="role-card-name">{item.name}<small>{dateLabel(item.lastTime)}</small></span><span className="role-card-preview">{item.messageCount ? `${number(item.messageCount)} 条记录，随时慢慢翻看` : '这份备份暂时没有消息'}</span></span><ChevronRight size={14} />
          </button>)}{visibleRoles.length === 0 && <p className="empty-state">没有找到这个名字，换个词试试看。</p>}</div>
          <div className="sidebar-footer"><span className="tiny-star">✧</span><p>不必一次读完。<br /><span>这一页，等你有空再翻。</span></p><button className="button secondary" onClick={() => inputRef.current?.click()} disabled={busy}><Plus size={17} />添加对话</button></div>
        </aside>
        <section className="reader" aria-label={`${role?.name ?? ''}的历史对话`}>
          <header className="reader-header"><div className="reader-heading"><button className="icon-button mobile-only" onClick={() => setShowSidebar(true)} aria-label="返回角色列表"><ChevronLeft size={22} /></button><span className="avatar avatar-sm">{initials(role?.name)}</span><div><h2>{role?.name}</h2><p><span className="tiny-star">✧</span> {number(role?.messageCount ?? 0)} 条珍藏的日常<span className="reader-header-separator">·</span>历史对话</p></div></div><div className="reader-tools"><button className="icon-button" aria-label="在对话中搜索" onClick={() => { setSearch({ query: '', roleId: role.id, from: '', to: '' }); setSearchPage(0); setModal('search'); }}><Search size={19} /></button><button className="button ghost" onClick={() => setModal('profile')}><Info size={17} /><span>角色资料</span></button></div></header>
          <div className="reader-subbar"><div className="reader-tabs" role="tablist" aria-label="阅读内容"><button id="history-tab" className={`reader-tab ${readerTab === 'history' ? 'active' : ''}`} role="tab" aria-selected={readerTab === 'history'} aria-controls="history-panel" onClick={() => setReaderTab('history')}><BookHeart size={16} />历史对话</button><button id="notes-tab" className={`reader-tab ${readerTab === 'notes' ? 'active' : ''}`} role="tab" aria-selected={readerTab === 'notes'} aria-controls="notes-panel" onClick={() => setReaderTab('notes')}><StickyNote size={16} />我的便笺{roleNotes.length > 0 && <span>{roleNotes.length}</span>}</button></div>{role?.conversations.length > 1 && <label className="conversation-select"><span className="sr-only">选择一段对话</span><select aria-label="选择一段对话" value={conversationId} onChange={event => { setConversationId(event.target.value); setPage(0); setFocusMessage(null); }}><option value="all">全部 {role.conversations.length} 段对话</option>{role.conversations.map(item => <option value={item.conversation_id} key={item.conversation_id}>{item.conversation_name || '未命名对话'}</option>)}</select></label>}</div>
          {readerTab === 'history' ? <>
            <div className="message-scroll" ref={scrollRef} id="history-panel" role="tabpanel" aria-labelledby="history-tab">
              <div className="message-page">
                <div className="conversation-intro"><span>✧</span><p>熟悉的文字，值得慢慢读。</p><span>✧</span></div>
                {shownMessages.map((message, index) => {
                  const previous = index > 0 ? shownMessages[index - 1] : null;
                  const day = getLocalDateKey(message.create_time);
                  const showDate = !previous || getLocalDateKey(previous.create_time) !== day;
                  const user = message.user_type === 'user';
                  return <div key={message.message_id}>{showDate && <div className="date-divider"><span>{dateLabel(message.create_time)}</span></div>}<article id={`message-${message.message_id}`} className={`message-row ${user ? 'from-user' : 'from-role'} ${focusMessage === message.message_id ? 'is-highlighted' : ''}`}>
                    {!user && <span className="avatar message-avatar" aria-hidden="true">{initials(role.name)}</span>}<div className="message-body"><span className="message-label">{user ? '我' : role.name}</span><div className="message-bubble"><Highlight text={message.text || '这条记录没有可显示的文字，原始内容会随备份保留。'} query={highlightQuery} /></div><time className="message-time">{timeLabel(message.create_time)}</time></div>{user && <span className="avatar message-avatar user-avatar" aria-hidden="true">我</span>}
                  </article></div>;
                })}
                {messages.length === 0 && <div className="empty-state"><BookHeart size={30} /><h3>这一段暂时没有消息</h3><p>备份中的角色资料已经保留，可以选择其他对话继续翻看。</p></div>}
                {messages.length > 0 && <nav className="page-controls" aria-label="对话翻页"><button className="button ghost small" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); setFocusMessage(null); }}><ChevronLeft size={16} />更早的记录</button><span>{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, messages.length)} / {number(messages.length)}</span><button className="button ghost small" disabled={currentPage === lastPage} onClick={() => { setPage(currentPage + 1); setFocusMessage(null); }}>后面的记录<ChevronRight size={16} /></button></nav>}
              </div>
            </div>
            <footer className="reader-footer"><span><BookHeart size={16} />原始对话，安心翻看</span><div>{lastPage > 0 && <button className="button ghost small" onClick={() => { setPage(currentPage === lastPage ? 0 : lastPage); setFocusMessage(null); }}>{currentPage === lastPage ? '从头翻看' : '最近一页'}<ArrowDownToLine size={14} /></button>}<button className="button secondary small" onClick={() => setReaderTab('notes')}><StickyNote size={15} />写一页便笺</button></div></footer>
          </> : <div className="notes-scroll" id="notes-panel" role="tabpanel" aria-labelledby="notes-tab"><section className="note-editor"><span className="eyebrow">A PAGE FOR YOURSELF</span><h3>这一页，留给现在的你。</h3><p className="muted">便笺单独保存，不会发送给角色。想写多少都可以，也可以先不写。</p><form onSubmit={saveNote}><label htmlFor="note-body" className="sr-only">私人便笺内容</label><textarea id="note-body" readOnly={busy || Boolean(recovery)} value={noteBody} onChange={event => setNoteBody(event.target.value)} placeholder="此刻的小心情，或是想留住的一句话……" rows={5} /><div className="note-editor-actions"><span className="muted">{demo ? '示例体验 · 不会保存到你的记录' : noteBody.trim() ? '这页还未保存，保存后会随完整备份带走' : '导出完整备份时，会带上已保存的便笺'}</span><div>{editingNote && <button type="button" className="button ghost small" onClick={() => { setEditingNote(null); setNoteBody(''); }}>取消编辑</button>}<button className="button primary" disabled={!noteBody.trim() || busy}><Check size={16} />{editingNote ? '保存修改' : '保存便笺'}</button></div></div></form></section><div className="note-list"><h3>我的便笺 <span className="muted">{roleNotes.length}</span></h3>{roleNotes.map(note => <article className="note-card" key={note.id}><header className="note-card-header"><time>{dateLabel(note.updatedAt)}</time><div><button className="button ghost small" onClick={() => { setEditingNote(note.id); setNoteBody(note.body); document.getElementById('note-body')?.focus(); }}>编辑</button><button className="icon-button" aria-label="删除这页便笺" onClick={() => setDeletingNote(note.id)} disabled={busy}><Trash2 size={15} /></button></div></header><p className="note-content">{note.body}</p>{deletingNote === note.id && <div className="note-delete-confirm"><p>要移除这页便笺吗？原始对话不会改变。</p><button className="button ghost small" onClick={() => setDeletingNote(null)}>保留</button><button className="button danger small" disabled={busy} onClick={() => removeNote(note.id)}>确认移除</button></div>}</article>)}{roleNotes.length === 0 && <p className="empty-state">这里还没有便笺。留白也很好。</p>}</div></div>}
        </section>
      </main>}

    {modal && <Dialog key={modal} title={{ import: '添加你的对话', settings: '把这里调成喜欢的样子', help: '第一次使用，慢慢来', search: '找回想看的那一句', profile: '角色资料' }[modal]} busy={busy} wide={modal === 'search' || modal === 'settings'} onClose={closeModal}>
      {notice && ['settings', 'import'].includes(modal) && !(modal === 'import' && recovery?.source === 'import' && notice.text === recovery.message) && <div className={`status-banner ${notice.kind}`} role="status"><Info size={16} /><p>{notice.text}</p></div>}
      {modal === 'import' && <>
        <p className="muted">文件只在当前设备读取，原文件不会改变。支持一次选择多份 JSON。</p>
        {busy && <div className="empty-state"><FileJson size={28} /><p>{pendingImport ? '正在把记录保存在当前浏览器，请稍等片刻。' : '正在整理这几页记录，请稍等片刻。'}</p></div>}
        {importError && <div className="status-banner warning import-feedback" role={importReview ? 'status' : 'alert'}>
          <Info size={20} /><div><p>{importError}</p>
            <div className="import-feedback-actions">
              {importReview && <button className="button primary small" onClick={() => importFiles(importReview, { allowLargeFiles: true })}>继续尝试导入</button>}
              <button className="button secondary small" onClick={() => inputRef.current?.click()}>重新选择文件</button>
              <button className="button ghost small" onClick={returnFromImport}>先返回，稍后再试</button>
            </div>
          </div>
        </div>}
        {!busy && pendingImport && <>
          <div className="import-summary"><h3>{recovery?.source === 'import' ? '记录已读入本页，这次还没有保存。' : '记录已准备好，确认后即可打开。'}</h3><div className="stats-grid"><div className="stat"><strong>{pendingImport.roles.length}</strong><span>整理后的角色</span></div><div className="stat"><strong>{number(pendingImport.reports.reduce((sum, report) => sum + report.addedMessages, 0))}</strong><span>新增对话消息</span></div><div className="stat"><strong>{number(pendingImport.reports.reduce((sum, report) => sum + report.skippedMessages, 0))}</strong><span>重复消息已跳过</span></div></div>{pendingImport.names.length > 0 && <p className="import-role-names">{pendingImport.names.slice(0, 12).join(' · ')}{pendingImport.names.length > 12 ? ' ……' : ''}</p>}</div>
          <ul className="file-list">{pendingImport.reports.map((report, index) => <li key={index}><FileJson size={18} /><span>{report.name}<small>{report.kind === 'backup' ? '完整备份' : '原始对话'} · 新增 {report.addedMessages} 条消息{report.addedNotes ? `、${report.addedNotes} 页便笺` : ''}</small></span><Check size={16} /></li>)}</ul>
          {demo && <p className="privacy-note"><ShieldCheck size={15} />只会合并到你的真实记录，虚构示例不会加入。</p>}
          {pendingImport.reports.some(report => report.kind === 'backup') && <p className="muted">完整备份中的便笺与外观设置也会一起恢复。</p>}
          {storageMode !== 'ready' && <div className="error-box"><p>当前浏览器无法保存。确认后仅在本页查看；关闭前请导出完整备份，原文件也请保留。</p></div>}
          {recovery?.source === 'import' && <div className="status-banner warning import-feedback" role="alert"><Info size={18} /><div>
            <p>{recovery.message}</p>
            {recovery.code === 'STORAGE_FULL' && <StorageSpaceHelp isImport />}
            <div className="import-feedback-actions"><button className="button secondary small" onClick={() => exportData('full', recovery.archive, true)}>导出尚未保存的内容</button></div>
          </div></div>}
          <div className="dialog-footer"><button className="button ghost" disabled={busy} onClick={returnFromImport}>{recovery?.source === 'import' ? '先返回，稍后再试' : '再等等'}</button><button className="button primary" disabled={busy || recovery?.code === 'STALE_STATE'} onClick={confirmImport}><BookHeart size={17} />{recovery?.source === 'import' ? '重试保存' : storageMode === 'ready' ? '确认导入，开始翻看' : '仅在本页打开'}</button></div>
        </>}
      </>}
      {modal === 'profile' && role && <div className="profile-content"><span className="avatar avatar-lg">{initials(role.name)}</span><h3>{role.name}</h3><span className="tag">来自你的对话备份</span><div className="stats-grid"><div className="stat"><strong>{number(role.messageCount)}</strong><span>条消息</span></div><div className="stat"><strong>{role.conversations.length}</strong><span>段对话</span></div><div className="stat"><strong>{roleNotes.length}</strong><span>页私人便笺</span></div></div><p className="profile-date">{dateLabel(role.firstTime)} — {dateLabel(role.lastTime)}</p><p className="muted">当前仅展示备份中可识别的角色名称和对话记录。未找到可用的原头像或角色介绍，头像以名字首字代替。</p><button className="button secondary" onClick={() => { setModal(null); setReaderTab('history'); }}>回到对话<ArrowRight size={16} /></button></div>}
      {modal === 'search' && <>
        <form className="search-form" onSubmit={event => event.preventDefault()}><label className="field"><span>想找的文字</span><div className="search-input"><Search size={19} /><input autoFocus value={search.query} onChange={event => updateSearch({ query: event.target.value })} placeholder="一个词、一句话，或一段小小的日常" /></div></label><div className="field-row"><label className="field"><span>角色</span><select aria-label="角色" value={search.roleId} onChange={event => updateSearch({ roleId: event.target.value })}><option value="">全部角色</option>{roles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="field"><span>开始日期</span><input type="date" value={search.from} onChange={event => updateSearch({ from: event.target.value })} /></label><label className="field"><span>结束日期</span><input type="date" value={search.to} onChange={event => updateSearch({ to: event.target.value })} /></label></div></form>
        {searchInvalid && <p className="error-box" role="alert">结束日期需要在开始日期之后，也可以是同一天。</p>}
        <div className="search-results" aria-live="polite"><div className="section-label"><span>{searchActive ? `找到 ${number(results.length)} 条记录` : '从一个词，或一个日期开始'}</span>{searchActive && <button className="button ghost small" onClick={() => { setSearch({ query: '', roleId: '', from: '', to: '' }); setSearchPage(0); }}>清空筛选</button>}</div>{results.slice(searchPage * 40, (searchPage + 1) * 40).map(message => <button key={message.message_id} className="search-result" onClick={() => jumpToMessage(message)}><span className="search-result-top"><strong>{message.roleName}</strong><small>{dateLabel(message.create_time)} {timeLabel(message.create_time)}</small><ArrowRight size={16} /></span><span className="result-excerpt"><Highlight text={message.text} query={search.query} /></span><span className="search-result-hint">查看这句话前后的对话</span></button>)}{searchActive && !searchInvalid && results.length === 0 && <div className="empty-state"><Search size={28} /><p>这次没有找到。试试短一点的关键词，或放宽日期范围。</p></div>}{results.length > 40 && <div className="page-controls"><button className="button ghost small" disabled={searchPage === 0} onClick={() => setSearchPage(searchPage - 1)}><ChevronLeft size={16} />上一页</button><span>{searchPage + 1} / {Math.ceil(results.length / 40)}</span><button className="button ghost small" disabled={(searchPage + 1) * 40 >= results.length} onClick={() => setSearchPage(searchPage + 1)}>下一页<ChevronRight size={16} /></button></div>}</div>
      </>}
      {modal === 'help' && <><p className="muted">不用了解文件里的代码，照着这几步操作就好。</p><Help initial /></>}
      {modal === 'settings' && <>
        <section className="settings-section"><div className="section-label"><span>01 / 选一种今天喜欢的颜色</span><Heart size={16} /></div><div className="theme-options">{THEMES.map(theme => <button key={theme.id} className={`theme-option theme-${theme.id} ${archive.preferences.theme === theme.id ? 'selected' : ''}`} aria-pressed={archive.preferences.theme === theme.id} onClick={() => changePreferences({ theme: theme.id })} disabled={busy}><span className="theme-preview"><span>{theme.icon}</span><i /><i />{archive.preferences.theme === theme.id && <Check size={16} />}</span><strong>{theme.name}</strong><small>{theme.description}</small></button>)}</div><div className="appearance-controls"><label className="inline-field" htmlFor="font-size"><span>阅读字号 <strong>{archive.preferences.fontSize}</strong></span><input id="font-size" type="range" min="14" max="22" step="1" value={archive.preferences.fontSize} disabled={busy} onChange={event => changePreferences({ fontSize: Number(event.target.value) })} /></label><label className="inline-field decoration-toggle"><span>一点星星装饰</span><input type="checkbox" checked={archive.preferences.decorations} disabled={busy} onChange={event => changePreferences({ decorations: event.target.checked })} /><span className="toggle-track" aria-hidden="true" /></label></div></section>
        <section className="settings-section"><div className="section-label"><span>02 / 对话与备份</span><FolderHeart size={17} /></div><p className="muted">{demo ? '当前展示的是虚构示例。下载的也将是示例文件。' : `${stats.roles} 位角色 · ${number(stats.messages)} 条消息 · ${stats.notes} 页便笺。${storageMode === 'ready' ? '内容保存在当前设备的当前浏览器。' : '当前内容只在本页，尚未保存到浏览器。'}`}</p><div className="backup-actions"><button className="button secondary" onClick={() => inputRef.current?.click()} disabled={busy}><Upload size={17} />添加对话 / 恢复备份</button><button className="button primary" onClick={() => exportData('full')} disabled={!stats.conversations}><Download size={17} />导出完整备份</button><button className="button ghost" onClick={() => exportData('conversations')} disabled={!stats.conversations}><FileJson size={17} />导出原格式对话</button></div><p className="backup-tip"><ShieldCheck size={17} /><span>换设备时，选择<strong>完整备份</strong>，便笺和外观也能一起带走。下载后，请在浏览器下载列表中确认文件已下载。</span></p><p className="muted">原格式对话只包含聊天记录。清理浏览器数据前，请先导出备份，并继续保留原文件。</p>{recovery && <button className="button secondary" onClick={() => exportData('full', recovery.archive, true)}>导出本次未保存的内容</button>}</section>
        <section className="settings-section"><div className="section-label"><span>03 / 使用帮助</span><HelpCircle size={17} /></div><Help /></section>
        <section className="settings-section settings-about">
          <details className="help-section">
            <summary><span>关于拾光</span><ChevronRight size={16} /></summary>
            <div className="about-content">
              <p>拾光由 ForOneIce 开发。愿这里成为一处可以按自己的节奏，慢慢翻阅的小角落。</p>
              <a className="about-link" href="https://github.com/ForOneIce" target="_blank" rel="noopener noreferrer">
                <span><strong>了解开发者</strong><small>ForOneIce · GitHub</small></span>
                <ExternalLink size={17} aria-hidden="true" /><span className="sr-only">（在新标签页打开）</span>
              </a>
              <a className="about-link" href="https://creativecommons.org/licenses/by-nc-sa/4.0/deed.zh-hans" target="_blank" rel="noopener noreferrer">
                <span><strong>使用许可</strong><small>CC BY-NC-SA 4.0</small></span>
                <ExternalLink size={17} aria-hidden="true" /><span className="sr-only">（在新标签页打开）</span>
              </a>
              <p className="about-license">署名 · 非商业性使用 · 相同方式共享</p>
              <p>分享或改编本项目时，请保留 ForOneIce 的署名和协议链接，并注明修改；发布改编作品须使用相同协议。商业使用需另行获得授权。</p>
              <p>此许可适用于项目本身，不改变你导入的对话与私人便笺的权利归属。第三方组件遵循各自的许可证。</p>
            </div>
          </details>
        </section>
        <p className="settings-footer"><BookHeart size={17} />拾光 · 按自己的节奏，慢慢翻看。</p>
      </>}
    </Dialog>}
  </div>;
}
