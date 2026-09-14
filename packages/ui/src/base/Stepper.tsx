// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

/*
  Where the reader is in a flow they have not finished, and what is still ahead of them.

  "Step 2 of 3" is a count. It tells someone how far along they are and nothing about what is
  coming, so the decision it leaves them with — is this worth continuing? — is one they have to
  make blind. Naming all three, with the ones behind them settled, answers that before they ask.

  The list is ordered and one item is current, so it is an <ol> with aria-current on that item:
  a screen reader announces "3 items, item 2, current" without being told to.
*/

export interface Step {
  /* Stable across renders; used as the key and nowhere else. */
  readonly id: string;
  /* One or two words. This is read at a glance, beside two others. */
  readonly label: string;
}

export function Stepper({
  steps,
  current,
  label = 'Progress',
}: {
  readonly steps: readonly Step[];
  /* 1-based: the step the reader is on now. */
  readonly current: number;
  readonly label?: string;
}) {
  return (
    <ol className="w-stepper" aria-label={label}>
      {steps.map((step, index) => {
        const position = index + 1;
        const state = position < current ? 'done' : position === current ? 'current' : 'ahead';
        return (
          <li
            key={step.id}
            className={`w-stepper__step w-stepper__step--${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="w-stepper__mark" aria-hidden="true">
              {state === 'done' ? '✓' : position}
            </span>
            <span className="w-stepper__label">{step.label}</span>
            {/*
              The rule between two steps is drawn by the step on its left, so the last step draws
              none and the row ends on a label rather than on a line going nowhere.
            */}
            {position < steps.length ? <span className="w-stepper__rule" aria-hidden="true" /> : null}
          </li>
        );
      })}
    </ol>
  );
}
