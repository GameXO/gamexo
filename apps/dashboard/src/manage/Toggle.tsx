export default function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onChange}
      className={`relative flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        checked ? 'bg-lime' : 'bg-border-input'
      } ${disabled ? 'opacity-40' : ''}`}
    >
      <span
        className={`absolute size-5 rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
