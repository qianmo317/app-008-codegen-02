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

export type Advance = {
  id: string;
  payer: string; // 垫钱的人
  amount: number; // 金额（元）
  reason: string; // 事由
  photo?: string; // 凭证照片（压缩 dataURL）
  paidAt: number; // 垫付时间
  createdAt: number;
  reimbursementId?: string; // 所在报销批次 id；有值表示已报销
};

export type Reimbursement = {
  id: string;
  advanceIds: string[]; // 本次合成的垫付记录
  total: number;
  note?: string;
  createdAt: number; // 报销时间
};

export type MoveTask = {
  id: string;
  title: string;
  from: string;
  to: string;
  date: string;
  rooms: string[];
  boxes: Box[];
  advances?: Advance[];
  reimbursements?: Reimbursement[];
  advanceDueDays?: number; // 约定报销天数，逾期未报单独列出
  createdAt: number;
};
