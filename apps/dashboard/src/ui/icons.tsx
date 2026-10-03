import { HugeiconsIcon, type HugeiconsIconProps, type IconSvgElement } from '@hugeicons/react'
import {
  Add01Icon,
  Alert02Icon,
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowDown02Icon,
  ArrowLeft01Icon,
  ArrowLeft02Icon,
  ArrowRight01Icon,
  ArrowRight02Icon,
  ArrowUp02Icon,
  BankIcon,
  Call02Icon,
  Calendar03Icon,
  CalendarCheck01Icon,
  CalendarClockIcon,
  Camera01Icon,
  Cancel01Icon,
  Cash01Icon,
  CheckmarkBadge01Icon,
  CheckmarkCircle02Icon,
  CircleIcon,
  Clock01Icon,
  ComputerIcon,
  Copy01Icon,
  Crown02Icon,
  CreditCardIcon,
  DashboardSquare01Icon,
  Delete02Icon,
  Download01Icon,
  DropletIcon,
  FeatherIcon,
  File01Icon,
  FileDownloadIcon,
  FlashIcon,
  FootprintsIcon,
  ImageAdd01Icon,
  InformationCircleIcon,
  Invoice03Icon,
  Key01Icon,
  Link01Icon,
  Loading03Icon,
  LockIcon,
  Login01Icon,
  Logout01Icon,
  Mail01Icon,
  Menu01Icon,
  Message01Icon,
  MessageAdd01Icon,
  MinusSignIcon,
  MoreHorizontalIcon,
  Mortarboard01Icon,
  Notification01Icon,
  PackageIcon,
  PaintBoardIcon,
  PauseIcon,
  PencilEdit02Icon,
  PlayIcon,
  PlugSocketIcon,
  PrinterIcon,
  RadioButtonIcon,
  RefreshIcon,
  RotateLeft01Icon,
  RotateRight01Icon,
  RupeeIcon,
  Search01Icon,
  SecurityBlockIcon,
  SecurityCheckIcon,
  SecurityWarningIcon,
  SentIcon,
  Settings02Icon,
  Shield01Icon,
  Shirt01Icon,
  ShoppingBag01Icon,
  SmartPhone01Icon,
  StarIcon,
  Store01Icon,
  Table02Icon,
  Tag01Icon,
  TradeDownIcon,
  TradeUpIcon,
  Tick02Icon,
  UnfoldMoreIcon,
  Upload01Icon,
  User02Icon,
  UserGroupIcon,
  UserIcon,
  UserMinus01Icon,
  UserRemove01Icon,
  ViewIcon,
  ViewOffIcon,
  Wallet01Icon,
  LinkSquare02Icon,
  Calendar01Icon,
  CashierIcon,
  FootballPitchIcon,
  HelpCircleIcon,
  Layers01Icon,
  ShoppingCartAdd01Icon,
  TrophyIcon,
  UserMultiple02Icon,
  ChartHistogramIcon,
  PieChartIcon,
} from '@hugeicons-pro/core-bulk-rounded'

/**
 * The dashboard's icon set (Hugeicons Pro, Bulk Rounded).
 *
 * Every icon is exported under the name the app already used for it, so a call
 * site reads `<Check size={15} />` and only its import path says where the icon
 * comes from. Swapping an icon, or the whole style, is a one-line edit here
 * rather than a hunt through ~90 files.
 *
 * Sizing works as before: `size={n}` or a Tailwind `h-4 w-4` class (the class
 * wins over the svg's width/height attributes). Colour is `currentColor`; the
 * Bulk style draws its secondary shapes as a translucent tint of the same colour.
 */
export type IconProps = Omit<HugeiconsIconProps, 'icon'>
export type IconComponent = (props: IconProps) => React.JSX.Element

const make =
  (icon: IconSvgElement): IconComponent =>
  (props) => <HugeiconsIcon aria-hidden="true" {...props} icon={icon} />

export const AlertCircle = make(AlertCircleIcon)
export const AlertTriangle = make(Alert02Icon)
export const ArrowDown = make(ArrowDown02Icon)
export const ArrowLeft = make(ArrowLeft02Icon)
export const ArrowRight = make(ArrowRight02Icon)
export const ArrowUp = make(ArrowUp02Icon)
export const BadgeCheck = make(CheckmarkBadge01Icon)
export const Banknote = make(Cash01Icon)
export const Bell = make(Notification01Icon)
export const Calendar = make(Calendar03Icon)
export const CalendarCheck2 = make(CalendarCheck01Icon)
export const CalendarClock = make(CalendarClockIcon)
export const CalendarDays = make(Calendar01Icon)
export const Camera = make(Camera01Icon)
export const Check = make(Tick02Icon)
export const CheckCircle2 = make(CheckmarkCircle02Icon)
export const ChevronDown = make(ArrowDown01Icon)
export const ChevronLeft = make(ArrowLeft01Icon)
export const ChevronRight = make(ArrowRight01Icon)
export const ChevronsUpDown = make(UnfoldMoreIcon)
export const Circle = make(CircleIcon)
export const CircleCheck = make(CheckmarkCircle02Icon)
export const CircleDot = make(RadioButtonIcon)
export const Clock = make(Clock01Icon)
export const Copy = make(Copy01Icon)
export const CreditCard = make(CreditCardIcon)
export const Download = make(Download01Icon)
export const Droplet = make(DropletIcon)
export const ExternalLink = make(LinkSquare02Icon)
export const Eye = make(ViewIcon)
export const EyeOff = make(ViewOffIcon)
export const Feather = make(FeatherIcon)
export const FileDown = make(FileDownloadIcon)
export const FileText = make(File01Icon)
export const Footprints = make(FootprintsIcon)
export const GraduationCap = make(Mortarboard01Icon)
export const ImagePlus = make(ImageAdd01Icon)
export const IndianRupee = make(RupeeIcon)
export const Info = make(InformationCircleIcon)
export const KeyRound = make(Key01Icon)
export const Landmark = make(BankIcon)
export const LayoutGrid = make(DashboardSquare01Icon)
export const Link2 = make(Link01Icon)
export const Loader2 = make(Loading03Icon)
export const Lock = make(LockIcon)
export const LogIn = make(Login01Icon)
export const LogOut = make(Logout01Icon)
export const Mail = make(Mail01Icon)
export const Menu = make(Menu01Icon)
export const MessageCircle = make(Message01Icon)
export const MessageSquarePlus = make(MessageAdd01Icon)
export const Minus = make(MinusSignIcon)
export const Monitor = make(ComputerIcon)
export const MoreHorizontal = make(MoreHorizontalIcon)
export const Package = make(PackageIcon)
export const Palette = make(PaintBoardIcon)
export const Pause = make(PauseIcon)
export const Pencil = make(PencilEdit02Icon)
export const Phone = make(Call02Icon)
export const Play = make(PlayIcon)
export const Plug = make(PlugSocketIcon)
export const Plus = make(Add01Icon)
export const Printer = make(PrinterIcon)
export const ReceiptText = make(Invoice03Icon)
export const RefreshCw = make(RefreshIcon)
export const RotateCcw = make(RotateLeft01Icon)
export const RotateCw = make(RotateRight01Icon)
export const Search = make(Search01Icon)
export const Send = make(SentIcon)
export const Settings2 = make(Settings02Icon)
export const Shield = make(Shield01Icon)
export const ShieldAlert = make(SecurityWarningIcon)
export const ShieldCheck = make(SecurityCheckIcon)
export const ShieldOff = make(SecurityBlockIcon)
export const Shirt = make(Shirt01Icon)
export const ShoppingBag = make(ShoppingBag01Icon)
export const Smartphone = make(SmartPhone01Icon)
export const Crown = make(Crown02Icon)
export const Star = make(StarIcon)
export const Store = make(Store01Icon)
export const Table2 = make(Table02Icon)
export const Tag = make(Tag01Icon)
export const Trash2 = make(Delete02Icon)
export const TrendingDown = make(TradeDownIcon)
export const TrendingUp = make(TradeUpIcon)
export const TriangleAlert = make(Alert02Icon)
export const Upload = make(Upload01Icon)
export const User = make(UserIcon)
export const UserMinus = make(UserMinus01Icon)
export const UserRound = make(User02Icon)
export const Users = make(UserGroupIcon)
export const UserX = make(UserRemove01Icon)
export const Wallet = make(Wallet01Icon)
export const X = make(Cancel01Icon)
export const Zap = make(FlashIcon)
export const BarChart = make(ChartHistogramIcon)
export const PieChart = make(PieChartIcon)
export const Cashier = make(CashierIcon)
export const CartPlus = make(ShoppingCartAdd01Icon)
export const FootballPitch = make(FootballPitchIcon)
export const HelpCircle = make(HelpCircleIcon)
export const Layers = make(Layers01Icon)
export const Trophy = make(TrophyIcon)
export const UsersRound = make(UserMultiple02Icon)

