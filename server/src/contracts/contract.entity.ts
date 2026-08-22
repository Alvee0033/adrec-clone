import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('contracts')
export class Contract {
  @PrimaryColumn()
  id: string;

  @Column({ nullable: true })
  number: string;

  @Column({ nullable: true })
  issueDate: string;

  @Column({ nullable: true })
  startDate: string;

  @Column({ nullable: true })
  endDate: string;

  @Column({ type: 'numeric', nullable: true })
  annualRent: number;

  @Column({ type: 'numeric', nullable: true })
  value: number;

  @Column({ nullable: true })
  type: string;

  @Column({ nullable: true })
  term: string;

  @Column({ type: 'int', nullable: true })
  payments: number;

  @Column({ type: 'int', nullable: true })
  occupants: number;

  @Column({ nullable: true })
  tenantName: string;

  @Column({ nullable: true })
  tenantEmiratesId: string;

  @Column({ nullable: true })
  tenantNationality: string;

  @Column({ nullable: true })
  tenantMobile: string;

  @Column({ nullable: true })
  tenantEmail: string;

  @Column({ nullable: true })
  lessorCompany: string;

  @Column({ nullable: true })
  lessorLicense: string;

  @Column({ nullable: true })
  lessorName: string;

  @Column({ nullable: true })
  lessorMobile: string;

  @Column({ nullable: true })
  lessorEmail: string;

  @Column({ nullable: true })
  propertyName: string;

  @Column({ nullable: true })
  propertyType: string;

  @Column({ nullable: true })
  municipality: string;

  @Column({ nullable: true })
  zone: string;

  @Column({ nullable: true })
  sector: string;

  @Column({ nullable: true })
  plot: string;

  @Column({ nullable: true })
  premise: string;

  @Column({ type: 'int', nullable: true })
  rooms: number;

  @Column({ nullable: true })
  unitType: string;

  @Column({ nullable: true })
  unitRegNo: string;

  @Column({ nullable: true })
  unitNumber: string;

  @Column({ default: false })
  autoDeleteEnabled: boolean;

  @Column({ nullable: true, type: 'timestamp' })
  autoDeleteAt: Date;

  @Column({ nullable: true })
  pdfUrl: string;

  @Column({ type: 'bytea', nullable: true })
  pdfData: Buffer;
}
