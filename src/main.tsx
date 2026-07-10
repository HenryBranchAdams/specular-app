import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Compass, Eye, Flame, Sparkles } from 'lucide-react';
import type { NextQuestionResult, ThreadUnderstanding } from './domain/contracts';
import { validateOperationResult } from './domain/validators';
import './styles.css';

interface SavedReflection {
  question: string;
  text: string;
  at: string;
}

const EMPTY_UNDERSTANDING: ThreadUnderstanding = {
  claims: [],
  observations: [],
  stakeholders: [],
  contexts: [],
  distinctions: [],
  tensions: [],
  exploredBlindSpots: [],
  unexploredBlindSpots: [],
};

function buildQuestion(input: string): NextQuestionResult {
  const hasInput = input.trim().length > 0;
  const candidate = {
    kind: 'question' as const,
    ...(hasInput ? { setup: 'Let us make the boundary concrete.' } : {}),
    question: hasInput
      ? 'Which claim or distinction most needs a concrete boundary?'
      : 'What are you actually trying to understand?',
    understanding: EMPTY_UNDERSTANDING,
  };

  return validateOperationResult('next_question', candidate);
}

function App() {
  const [input, setInput] = useState('');
  const [selected, setSelected] = useState<NextQuestionResult>(() => buildQuestion(''));
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState<SavedReflection[]>([]);

  const generated = useMemo(() => buildQuestion(input), [input]);

  function generate() {
    setSelected(generated);
  }

  function saveReflection() {
    const text = notes.trim();
    if (!text) return;
    setSaved((current) => [{
      question: selected.question,
      text,
      at: new Date().toLocaleString(),
    }, ...current].slice(0, 5));
    setNotes('');
  }

  return (
    <main className="page">
      <section className="hero">
        <nav className="nav">
          <span className="mark"><span className="markIcon"><Sparkles size={16}/></span> Specular</span>
          <div className="navLinks"><a href="#about">How it works</a><a href="#try">Try it</a></div>
        </nav>
        <div className="heroCopy">
          <p className="eyebrow">A thinking tool for sharper ideas</p>
          <h1>Turn messy thoughts into clear questions.</h1>
          <p className="lead">Specular helps you refine ideas, stress-test assumptions, and see the shape of your thinking before you act on it.</p>
          <div className="actions"><a className="button primary" href="#try">Sharpen a thought <ArrowRight size={16}/></a><a className="button" href="#about">See how it works</a></div>
        </div>
        <div className="productShell">
          <div className="appWindow">
            <div className="windowBar"><span></span><span></span><span></span><p>Specular workspace</p></div>
            <div className="mockGrid">
              <section className="mockMain">
                {selected.setup === undefined ? null : <p>{selected.setup}</p>}
                <h2>{selected.question}</h2>
                <div className="answerLine"></div><div className="answerLine short"></div>
              </section>
            </div>
          </div>
          <div className="cursor one">Assumption?</div>
          <div className="cursor two">Sharper</div>
        </div>
      </section>

      <section id="about" className="strip">
        <div><Compass/><h3>Make the question concrete</h3><p>Turn a cloudy thought into something you can actually inspect.</p></div>
        <div><Flame/><h3>Stress-test the idea</h3><p>Find the assumptions, reversals, and counterexamples that matter.</p></div>
        <div><Eye/><h3>Refine without overbuilding</h3><p>No account, no feed, no productivity theater — just a focused thinking surface.</p></div>
      </section>

      <section id="try" className="workbench">
        <div className="panelIntro">
          <p className="eyebrow">Try Specular</p>
          <h2>Bring any thought you want to make sharper.</h2>
          <p>Use it for a belief, decision, argument, plan, conversation, draft, question, or half-formed intuition.</p>
        </div>
        <textarea className="idea" value={input} onChange={(event) => { setInput(event.target.value); }} placeholder="Example: I think this argument is right, but I can't tell which part is actually doing the work..." />
        <button className="button primary wide" onClick={generate}>Sharpen this thought</button>
        <div className="questionBox">
          {selected.setup === undefined ? null : <p>{selected.setup}</p>}
          <h3>{selected.question}</h3>
        </div>
        <textarea className="reflection" value={notes} onChange={(event) => { setNotes(event.target.value); }} placeholder="Write the rough answer. Precision beats polish." />
        <button className="button subtle" onClick={saveReflection}>Keep this note locally</button>
      </section>

      <section className="saved">
        <h2>Recent notes</h2>
        {saved.length === 0 ? <p className="muted">Saved notes appear here in this browser session only.</p> : saved.map((item, i) => (
          <article key={i} className="savedItem"><span>{item.at}</span><h3>{item.question}</h3><p>{item.text}</p></article>
        ))}
      </section>
    </main>
  );
}

const rootElement = document.getElementById('root');

if (rootElement === null) {
  throw new Error('Specular root element was not found.');
}

createRoot(rootElement).render(<App />);
