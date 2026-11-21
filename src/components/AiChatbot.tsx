import React, { useEffect, useRef, useState } from 'react';
import { Bot, MessageSquare, Send, Trash2, X } from 'lucide-react';
import type {
  AgentCase,
  BaselineProfile,
  SecurityRule,
  VectorSignature,
} from '../engine/types';
import { ApiHtmlResponseError, fetchJson } from '../lib/api';
import { runLocalChatAssistant } from '../lib/siemClientFallback';

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
}

interface AiChatbotProps {
  activeTraceId: string | null;
  activeCase: AgentCase | null;
  cases: AgentCase[];
  rules: SecurityRule[];
  vectors: VectorSignature[];
  baseline: BaselineProfile;
  localOnlyMode?: boolean;
}

const STARTER_PROMPTS = [
  'Explain why the active case was blocked in simple words',
  'How do the 3 OpenSearch Guard layers work together?',
  'How do I integrate agentsiem_sdk into a Python agent?',
];

export const AiChatbot: React.FC<AiChatbotProps> = ({
  activeTraceId,
  activeCase,
  cases,
  rules,
  vectors,
  baseline,
  localOnlyMode = false,
}) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [open, messages, sending]);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  const sendMessage = async (textToSend: string) => {
    const trimmed = textToSend.trim();
    if (!trimmed || sending) return;

    const userMessage: ChatMessage = {
      id: `user_${Date.now()}`,
      role: 'user',
      text: trimmed,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setError(null);
    setSending(true);

    try {
      let replyText: string;
      if (localOnlyMode) {
        replyText = runLocalChatAssistant({
          question: trimmed,
          activeCase,
          cases,
          rules,
          vectors,
          baseline,
        });
      } else {
        try {
          const data = await fetchJson<{ reply?: string }>('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: nextMessages.map((m) => ({ role: m.role, text: m.text })),
              activeTraceId,
            }),
          });
          if (!data.reply) {
            throw new Error('Unable to get a response from Gemini.');
          }
          replyText = data.reply;
        } catch (err) {
          if (err instanceof ApiHtmlResponseError) {
            replyText = runLocalChatAssistant({
              question: trimmed,
              activeCase,
              cases,
              rules,
              vectors,
              baseline,
            });
          } else {
            throw err;
          }
        }
      }
      setMessages((prev) => [
        ...prev,
        {
          id: `model_${Date.now()}`,
          role: 'model',
          text: replyText,
        },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to reach AI chat assistant.');
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  if (!open) {
    return (
      <div className="fixed bottom-4 right-4 z-40">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-950 px-4 py-2.5 text-xs font-semibold text-white shadow-lg transition-colors hover:border-blue-500 hover:bg-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 whitespace-nowrap"
        >
          <MessageSquare className="h-4 w-4 text-blue-400" aria-hidden="true" />
          <span>AI Security Chat</span>
        </button>
      </div>
    );
  }

  return (
    <aside
      aria-label="AgentSIEM AI Security Chat"
      className="fixed bottom-4 right-4 z-50 flex h-[540px] max-h-[82vh] w-[calc(100vw-2rem)] max-w-[420px] flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-black px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Bot className="h-4 w-4 shrink-0 text-blue-400" aria-hidden="true" />
            <h2 className="font-display text-xs font-semibold text-white truncate">
              AgentSIEM AI Assistant
            </h2>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-zinc-400 truncate">
            {activeTraceId ? `Context: ${activeTraceId}` : 'Context: Live SIEM Store'}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setMessages([]);
                setError(null);
              }}
              aria-label="Clear chat history"
              className="rounded-md border border-zinc-800 bg-zinc-950 p-1.5 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-100"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close AI chat"
            className="rounded-md border border-zinc-800 bg-zinc-950 p-1.5 text-zinc-400 transition-colors hover:border-zinc-700 hover:text-zinc-100"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto bg-black/70 p-4">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-zinc-300">
              Ask about any recorded flight trace, OpenSearch detection rule, k-NN similarity score, or how to wire the open-source Python SDK.
            </p>
            <div className="space-y-1.5">
              <div className="text-[11px] font-medium text-zinc-500">Suggested questions</div>
              {STARTER_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={sending}
                  onClick={() => void sendMessage(prompt)}
                  className="block w-full rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-2 text-left text-xs text-zinc-200 transition-colors hover:border-zinc-700 hover:bg-zinc-900 disabled:opacity-60"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap break-words ${
                  msg.role === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'border border-zinc-800 bg-zinc-950 text-zinc-200'
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))
        )}

        {sending && (
          <div className="flex justify-start">
            <div className="rounded-lg border border-zinc-800 bg-zinc-950 px-3.5 py-2 text-xs text-zinc-400">
              Analyzing telemetry...
            </div>
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-900/70 bg-red-950/50 p-3 text-xs text-red-200"
          >
            {error}
          </div>
        )}
      </div>

      {/* Composer */}
      <form
        onSubmit={handleSubmit}
        className="flex items-center gap-2 border-t border-zinc-800 bg-zinc-950 p-3"
      >
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about case_99, rules, or SDK..."
          aria-label="Ask AgentSIEM AI Assistant"
          disabled={sending}
          className="min-w-0 flex-1 rounded-lg border border-zinc-800 bg-black px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-blue-500 focus:outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          aria-label="Send chat message"
          className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
          <span>Send</span>
        </button>
      </form>
    </aside>
  );
};
