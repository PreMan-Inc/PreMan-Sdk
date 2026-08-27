# Plain Ruby. No Rails, no Sinatra, no routing of any kind.
module Inventory
  class Warehouse
    def initialize(items = [])
      @items = items
    end

    def add(item)
      @items << item
      self
    end

    def count
      @items.size
    end
  end
end
