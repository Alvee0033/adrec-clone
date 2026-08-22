import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Contract } from './contract.entity';
import { Repository, In, LessThanOrEqual } from 'typeorm';

@Injectable()
export class ContractsService implements OnModuleInit {
  constructor(
    @InjectRepository(Contract)
    private contractsRepository: Repository<Contract>,
  ) {}

  async onModuleInit() {
    const count = await this.contractsRepository.count();
    if (count === 0) {
      const c = new Contract();
      c.id = '202401452538';
      c.number = '202401452538';
      c.issueDate = '2025-06-26';
      c.startDate = '2025-08-02';
      c.endDate = '2026-08-03';
      c.annualRent = 63000;
      c.value = 63000;
      c.type = 'Residential';
      c.term = '1 Year';
      c.payments = 1;
      c.occupants = 1;
      c.tenantName = 'Allah Wasaya Peer Bakhsh';
      c.tenantEmiratesId = '784199582683266';
      c.tenantNationality = 'Pakistan';
      c.tenantMobile = '971526795995';
      c.tenantEmail = 'wasaya1995@gmail.com';
      c.lessorCompany = 'INTERNATIONAL CONSTRUCTION CONTRACTING - L L C';
      c.lessorLicense = 'CN-1048007';
      c.lessorName = 'SHINE PILLAI HARIDASAN PILLAI SANTHA KUMARI';
      c.lessorMobile = '971588973810';
      c.lessorEmail = 'shinepillaihs@gmail.com';
      c.propertyName = 'Sanad properties';
      c.propertyType = 'BUILDING';
      c.municipality = 'Abu Dhabi City';
      c.zone = 'Mohamed Bin Zayed City';
      c.sector = 'ME9';
      c.plot = 'C173';
      c.premise = '6391801694';
      c.rooms = 2;
      c.unitType = 'APARTMENT';
      c.unitRegNo = 'UNT308001';
      c.unitNumber = 'Flat No. 502';
      c.autoDeleteEnabled = false;
      
      await this.contractsRepository.save(c);
    }
  }

  async processAutoDeletes() {
    const now = new Date();
    const expired = await this.contractsRepository.find({
      where: {
        autoDeleteEnabled: true,
        autoDeleteAt: LessThanOrEqual(now),
      },
    });

    if (expired.length > 0) {
      const ids = expired.map(e => e.id);
      await this.contractsRepository.delete({ id: In(ids) });
      console.log(`Auto-deleted ${ids.length} contract(s)`);
    }
  }

  async findAll(): Promise<Record<string, Contract>> {
    const all = await this.contractsRepository.find();
    const map: Record<string, Contract> = {};
    for (const c of all) {
      map[c.id] = c;
    }
    return map;
  }

  async findOne(id: string): Promise<Contract | null> {
    return this.contractsRepository.findOne({ where: { id } });
  }

  async bulkDelete(ids: string[]): Promise<string[]> {
    const contracts = await this.contractsRepository.find({ where: { id: In(ids) } });
    const foundIds = contracts.map(c => c.id);
    if (foundIds.length > 0) {
      await this.contractsRepository.delete({ id: In(foundIds) });
    }
    return foundIds;
  }

  async autoDeleteSetup(ids: string[], enabled: boolean, deleteAt?: string): Promise<string[]> {
    const updateData: Partial<Contract> = {
      autoDeleteEnabled: enabled,
      autoDeleteAt: enabled && deleteAt ? new Date(deleteAt) : (null as any),
    };
    await this.contractsRepository.update({ id: In(ids) }, updateData);
    const updated = await this.contractsRepository.find({ where: { id: In(ids) } });
    return updated.map(c => c.id);
  }

  async saveContract(id: string, data: any): Promise<Contract> {
    const existing = await this.findOne(id);
    if (existing) {
      const merged = { ...existing, ...data };
      merged.autoDeleteEnabled = data.autoDeleteEnabled !== undefined ? Boolean(data.autoDeleteEnabled) : Boolean(existing.autoDeleteEnabled);
      merged.autoDeleteAt = data.autoDeleteAt !== undefined ? data.autoDeleteAt : existing.autoDeleteAt || null;
      await this.contractsRepository.save(merged);
      // Return merged directly — no second round-trip
      return merged as Contract;
    } else {
      const newContract = this.contractsRepository.create({ id, ...data });
      const saved = await this.contractsRepository.save(newContract) as unknown as Contract;
      return saved;
    }
  }

  async delete(id: string): Promise<boolean> {
    const result = await this.contractsRepository.delete(id);
    return (result.affected ?? 0) > 0;
  }

  async updatePdfUrl(id: string, pdfUrl: string) {
    await this.contractsRepository.update(id, { pdfUrl });
  }

  async savePdfData(id: string, buffer: Buffer) {
    await this.contractsRepository.update(id, { pdfData: buffer });
  }

  async getPdfData(id: string): Promise<Buffer | null> {
    const contract = await this.contractsRepository.findOne({ where: { id }, select: { pdfData: true } });
    return contract?.pdfData ?? null;
  }
}
