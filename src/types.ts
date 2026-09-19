export type BoxStatus = 'packed' | 'loaded' | 'arrived' | 'unpacked' | 'damaged' | 'missing';

export type Box = {
  id: string;
  code: string; // e.g. A-014
  roomFrom: string;
  roomTo: string;
  tags: string[];
  fragile: boolean;
  liquid: boolean;
  photo?: string; // compressed dataURL
  weightKg?: number;
  status: BoxStatus;
  note?: string;
  createdAt: number;
  updatedAt: number;
};

export type ExpenseCategory =
  | 'parking' // 停车费
  | 'carry' // 楼层搬运费
  | 'packing' // 打包耗材
  | 'meal' // 餐饮水饮
  | 'transport' // 打车/过路费
  | 'tip' // 小费/红包
  | 'other';

export type Expense = {
  id: string;
  payer: string; // 垫钱的人
  amount: number; // 金额（元）
  reason: string; // 事由
  category: ExpenseCategory;
  spentAt: number; // 垫付时间
  photo?: string; // 凭证照片（压缩 dataURL）
  reimbursementId?: string; // 已归入的报销批次，存在即表示已报销
  createdAt: number;
};

export type Reimbursement = {
  id: string;
  expenseIds: string[]; // 本次勾选报销的垫付笔
  total: number; // 合计金额
  byPayer: Record<string, number>; // 各垫付人应得金额
  note?: string;
  createdAt: number;
};

export type MoveTask = {
  id: string;
  title: string;
  from: string;
  to: string;
  date: string;
  rooms: string[];
  boxes: Box[];
  expenses: Expense[];
  reimbursements: Reimbursement[];
  dueWithinDays: number; // 约定报销天数，超过未报视为逾期
  reconciledPayerAt?: Record<string, number>; // 每个垫付人最近一次"账实核对相符"的时间
  createdAt: number;
};
