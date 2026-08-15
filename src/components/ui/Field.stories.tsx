import type { Meta, StoryObj } from '@storybook/react-vite';
import { Field } from './Field';
import { Textarea } from './textarea';

const meta = {
  title: 'Primitives/Field',
  component: Field,
  args: { children: <Textarea />, label: 'Field label' },
  parameters: { layout: 'padded' },
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => (
    <div className="ui-story-stack">
      <Field help="Your writing remains canonical." label="Writing block">
        <Textarea defaultValue="A synthetic thought about attention and certainty." />
      </Field>
      <Field error="The source could not be attached." label="Source note">
        <Textarea aria-invalid defaultValue="Synthetic source context" />
      </Field>
      <Field label="Unavailable field">
        <Textarea disabled value="Unavailable while synchronizing" />
      </Field>
    </div>
  ),
};
