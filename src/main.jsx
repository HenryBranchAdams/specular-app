import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Brain, CheckCircle2, Compass, Eye, Flame, Pause, RefreshCw, Sparkles } from 'lucide-react';
import './styles.css';

const starterPrompts = [
  {
    title: 'What are you actually trying to understand?',
    body: 'Take the thought in front of you and zoom out one level. Is the real question about facts, values, timing, fear, taste, obligation, or identity?',
    lens: 'core question',
  },
  {
    title: 'Which assumption is doing the most work?',
    body: 'Name the assumption your conclusion depends on most. If that assumption were only half true, how would your view need to change?',
    lens: 'assumption audit',
  },
  {
    title: 'What would change your mind?',
    body: 'Do not defend the thought yet. Define the kind of evidence, experience, or counterexample that would force a genuine revision.',
    lens: 'falsifiability',
  },
  {
    title: 'Where is the thought still blurry?',
    body: 'Separate what feels vivid from what is actually precise. Which word, claim, or distinction needs to be sharpened before you trust the idea?',
    lens: 'precision check',
  },
  {
    title: 'What is the strongest opposite version?',
    body: 'Build the best case against your current thought. Not the straw man — the version a smarter, calmer person might actually believe.',
    lens: 'steelman',
  },
];

const modes = [
  { key: 'Clarify', icon: Eye, text: 'Turn a vague thought into a cleaner question or claim.' },
  { key: 'Invert', icon: RefreshCw, text: 'Look from the opposite side and test the hidden frame.' },
  { key: 'Distill', icon: Pause, text: 'Strip away noise until the central distinction is visible.' },
];

function buildQuestion(input, mode) {
  const clean = input.trim();
  if (!clean) return starterPrompts[0];
  const words = clean.split(/\s+/).slice(0, 18).join(' ');
  if (mode === 'Invert') {
    return {
      title: 'Invert the frame',
      body: `If “${words}” were backwards, what would have to be true? What does the reversed version reveal about the assumption you were carrying?`,
      lens: 'generated inversion',
    };
  }
  if (mode === 'Distill') {
    return {
      title: 'Find the load-bearing distinction',
      body: `Inside “${words}”, which distinction matters most? Define the two sides so clearly that someone could disagree with the exact point instead of the general mood.`,
      lens: 'generated distillation',
    };
  }
  return {
    title: 'Clarify the claim',
    body: `When you say “${words}”, what is the smallest precise claim you are making? What would be different in the world if that claim were true?`,
    lens: 'generated clarification',
  };
}

function App() {
  const [input, setInput] = useState('');
  const [mode, setMode] = useState('Invert');
  const [selected, setSelected] = useState(starterPrompts[0]);
  const [notes, setNotes] = useState('');
  const [saved, setSaved] = useState([]);

  const generated = useMemo(() => buildQuestion(input, mode), [input, mode]);

  function generate() {
    setSelected(generated);
  }

  function saveReflection() {
    const text = notes.trim();
    if (!text) return;
    setSaved([{ question: selected.title, text, mode, at: new Date().toLocaleString() }, ...saved].slice(0, 5));
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
              <aside className="rail">
                <p>Modes</p>
                <button>Clarify</button>
                <button className="active">Invert</button>
                <button>Distill</button>
              </aside>
              <section className="mockMain">
                <div className="promptHeader"><span className="pill">{selected.lens}</span><CheckCircle2 size={18}/></div>
                <h2>{selected.title}</h2>
                <p>{selected.body}</p>
                <div className="answerLine"></div><div className="answerLine short"></div>
              </section>
            </div>
          </div>
          <div className="cursor one">Assumption?</div>
          <div className="cursor two">Sharper</div>
        </div>
      </section>

      <section id="about" className="strip">
        <div><Compass/><h3>Clarify the question</h3><p>Turn a cloudy thought into something you can actually inspect.</p></div>
        <div><Flame/><h3>Stress-test the idea</h3><p>Find the assumptions, reversals, and counterexamples that matter.</p></div>
        <div><Eye/><h3>Refine without overbuilding</h3><p>No account, no feed, no productivity theater — just a focused thinking surface.</p></div>
      </section>

      <section id="try" className="workbench">
        <div className="panelIntro">
          <p className="eyebrow">Try Specular</p>
          <h2>Bring any thought you want to make sharper.</h2>
          <p>Use it for a belief, decision, argument, plan, conversation, draft, question, or half-formed intuition.</p>
        </div>
        <div className="modes">
          {modes.map(({ key, icon: Icon, text }) => (
            <button key={key} onClick={() => setMode(key)} className={mode === key ? 'mode active' : 'mode'}>
              <Icon size={18}/><strong>{key}</strong><span>{text}</span>
            </button>
          ))}
        </div>
        <textarea className="idea" value={input} onChange={e => setInput(e.target.value)} placeholder="Example: I think this argument is right, but I can't tell which part is actually doing the work..." />
        <button className="button primary wide" onClick={generate}>Sharpen this thought</button>
        <div className="questionBox">
          <span className="pill">{selected.lens}</span>
          <h3>{selected.title}</h3>
          <p>{selected.body}</p>
        </div>
        <textarea className="reflection" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Write the rough answer. Precision beats polish." />
        <button className="button subtle" onClick={saveReflection}>Keep this note locally</button>
      </section>

      <section className="saved">
        <h2>Recent notes</h2>
        {saved.length === 0 ? <p className="muted">Saved notes appear here in this browser session only.</p> : saved.map((item, i) => (
          <article key={i} className="savedItem"><span>{item.at} · {item.mode}</span><h3>{item.question}</h3><p>{item.text}</p></article>
        ))}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
