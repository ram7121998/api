import { v4 as uuid } from "uuid";
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
export const generateUniqueTicketNumber = async () => {
    let number;
    let exists;
    do {
        number = `TICKET-${uuid().split("-")[0].toUpperCase()}`;
        exists = await prisma.support_tickets.findUnique({
            where: { ticket_number: number },
        });
    } while (exists);
    return number;
};
