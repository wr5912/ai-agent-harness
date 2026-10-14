import logo from '../assets/harness-logo.svg'

export function PlatformLogo({ size = 56 }: { size?: number }) {
  return <img src={logo} width={size} height={size} alt="Harness工程平台标识" />
}
